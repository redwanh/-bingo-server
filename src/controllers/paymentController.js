const PaymentAccount = require('../models/PaymentAccount');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// ========== EXTERNAL VERIFICATION CONFIG ==========
const VERIFY_API = process.env.VERIFY_API_URL || 'http://196.188.249.112:8003/api/v1';
const VERIFY_TOKEN = process.env.VERIFY_API_TOKEN || 'pav_token_2024_secure_key_1234567890abcdef';

// Test mode – bypass external API
const TEST_MODE = process.env.VERIFY_TEST_MODE === 'true';

async function verifyPayment({ transactionId, message, amount, paymentType }) {
  if (TEST_MODE) {
    logger.debug('Test mode: auto‑verifying payment');
    return {
      success: true,
      status: 'verified',
      transaction_id: transactionId || 'TEST-' + Date.now(),
      message: 'Test verification passed',
      data: { provider: paymentType, amount: parseFloat(amount) },
    };
  }

  const isMessageMode = !!message;
  const endpoint = isMessageMode ? `${VERIFY_API}/verify-message` : `${VERIFY_API}/verify`;

  const body = isMessageMode
    ? { message, expected_amount: parseFloat(amount), payment_type: paymentType }
    : { transaction_id: transactionId, amount: parseFloat(amount), payment_type: paymentType };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': VERIFY_TOKEN,
      },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch (err) {
    logger.error('External verification request failed', { error: err.message });
    return { success: false, message: 'Verification service unavailable' };
  }
}

// ========== PAYMENT ACCOUNTS ==========
exports.getPaymentAccounts = async (req, res, next) => {
  try {
    const accounts = await PaymentAccount.find({ isActive: true }).sort({ displayOrder: 1 });
    res.status(200).json({ success: true, data: accounts });
  } catch (error) { next(error); }
};

exports.getAllPaymentAccounts = async (req, res, next) => {
  try {
    const accounts = await PaymentAccount.find().sort({ displayOrder: 1 });
    res.status(200).json({ success: true, data: accounts });
  } catch (error) { next(error); }
};

exports.createPaymentAccount = async (req, res, next) => {
  try {
    const account = await PaymentAccount.create(req.body);
    res.status(201).json({ success: true, data: account });
  } catch (error) { next(error); }
};

exports.updatePaymentAccount = async (req, res, next) => {
  try {
    const account = await PaymentAccount.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!account) return next(new AppError('Account not found', 404));
    res.status(200).json({ success: true, data: account });
  } catch (error) { next(error); }
};

exports.deletePaymentAccount = async (req, res, next) => {
  try {
    await PaymentAccount.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Account deleted' });
  } catch (error) { next(error); }
};

// ========== DEPOSIT (NO TRANSACTION – SEQUENTIAL) ==========
exports.createDeposit = async (req, res, next) => {
  try {
    const {
      paymentAccountId,
      amount,
      transactionId,
      message,
      senderPhone,
      paymentType,
    } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 10) {
      return next(new AppError('Minimum deposit is 10 ETB', 400));
    }

    // Find payment account
    const account = await PaymentAccount.findById(paymentAccountId);
    if (!account) return next(new AppError('Payment account not found', 404));

    // Clean transaction ID
    let cleanTxnId = transactionId ? transactionId.trim().toUpperCase() : null;
    const detectedType = paymentType || account.type;
    if (detectedType === 'cbe' && cleanTxnId && cleanTxnId.length > 12) {
      cleanTxnId = cleanTxnId.slice(0, 12);
    }

    // 🔥 Verify payment externally (or test mode)
    const verificationResult = await verifyPayment({
      transactionId: cleanTxnId,
      message: message || null,
      amount: numAmount,
      paymentType: detectedType,
    });

    if (!verificationResult.success || verificationResult.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: verificationResult.message || 'Payment verification failed',
        status: verificationResult.status || 'failed',
      });
    }

    // ─── VERIFICATION PASSED ───
    const user = await User.findById(req.user._id);
    const balanceBefore = user.walletBalance || 0;
    const balanceAfter = balanceBefore + numAmount;

    // Update user balance (critical)
    user.walletBalance = balanceAfter;
    await user.save();

    // Create transaction record
    const transaction = await Transaction.create({
      userId: user._id,
      type: 'deposit',
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      direction: 'credit',
      status: 'completed',
      description: `Deposit via ${account.type} - Ref: ${cleanTxnId || verificationResult.transaction_id}`,
      reference: cleanTxnId || verificationResult.transaction_id,
      performedBy: user._id,
      performedByRole: 'user',
      metadata: {
        paymentAccountId: account._id,
        paymentType: account.type,
        senderPhone: senderPhone || user.phone,
        verificationData: verificationResult.data || {},
      },
    });

    // Create notification
    await Notification.create({
      user: user._id,
      type: 'payment',
      title: '💰 Deposit Successful',
      message: `${numAmount.toLocaleString()} ETB added. New balance: ${balanceAfter.toLocaleString()} ETB`,
      titleAm: '💰 ተቀማጭ ገንዘብ ተሳክቷል',
      messageAm: `${numAmount.toLocaleString()} ብር ተጨምሯል። አዲስ ሂሳብ: ${balanceAfter.toLocaleString()} ብር`,
      titleTg: '💰 ኣቀማምጣ ተዓዊቱ',
      messageTg: `${numAmount.toLocaleString()} ብር ተወስኪሉ። ሓድሽ ቀሪ ሒሳብ: ${balanceAfter.toLocaleString()} ብር`,
      priority: 'high',
      amount: numAmount,
      transactionId: transaction._id,
      actionUrl: '/transactions',
    });

    // Increment unread count
    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    logger.money('Deposit verified & processed', {
      userId: user._id,
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      externalTxnId: cleanTxnId,
    });

    res.status(200).json({
      success: true,
      message: 'Deposit successful!',
      data: {
        balance: balanceAfter,
        walletBalance: balanceAfter,
        amount: numAmount,
        transaction,
      },
    });
  } catch (error) {
    logger.error('Deposit error', { error: error.message, stack: error.stack });
    next(error);
  }
};


// ========== WITHDRAWAL (REQUIRES ADMIN APPROVAL) ==========
exports.createWithdrawal = async (req, res, next) => {
  try {
    const { amount, type = 'telebirr', accountInfo = 'N/A', phone } = req.body;
    if (!amount || amount <= 0) return next(new AppError('Enter a valid amount', 400));

    const user = await User.findById(req.user._id);
    if ((user.walletBalance || 0) < amount) return next(new AppError('Insufficient balance', 400));

    const balanceBefore = user.walletBalance;
    user.walletBalance -= parseFloat(amount);
    await user.save();

    const withdrawal = await Withdrawal.create({
      user: req.user._id,
      amount: parseFloat(amount),
      type,
      accountInfo: accountInfo || phone || 'N/A',
    });

    const transaction = await Transaction.create({
      userId: user._id,
      type: 'withdrawal',
      amount: parseFloat(amount),
      balanceBefore,
      balanceAfter: user.walletBalance,
      direction: 'debit',
      status: 'pending',
      performedBy: user._id,
      performedByRole: 'user',
      reference: 'WTD-' + withdrawal._id.toString().slice(-8).toUpperCase(),
      description: `Withdrawal via ${type} - Pending`,
    });

    withdrawal.transaction = transaction._id;
    await withdrawal.save();

    // Notify admins
    const admins = await User.find({ role: { $in: ['superadmin', 'admin', 'finance'] } });
    for (const admin of admins) {
      await Notification.create({
        user: admin._id,
        type: 'payment',
        title: 'New Withdrawal Request',
        message: `${user.fullName || user.phone} requests ${amount} ETB`,
        priority: 'high',
        amount: parseFloat(amount),
      });
    }

    // Notify user
    await Notification.create({
      user: user._id,
      type: 'payment',
      title: '💸 Withdrawal Submitted',
      message: `${amount} ETB deducted. Pending approval. New balance: ${user.walletBalance} ETB`,
      titleAm: '💸 ማውጣት ተጠይቋል',
      messageAm: `${amount} ብር ወጥቷል። በመጠባበቅ ላይ። አዲስ ሂሳብ: ${user.walletBalance} ብር`,
      titleTg: '💸 ምውጻእ ተሓቲቱ',
      messageTg: `${amount} ብር ወጺኡ። ብምጽባይ ላይ። ሓድሽ ቀሪ ሒሳብ: ${user.walletBalance} ብር`,
      priority: 'high',
      amount: parseFloat(amount),
    });

    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    res.status(200).json({
      success: true,
      message: 'Withdrawal submitted.',
      data: { balance: user.walletBalance, walletBalance: user.walletBalance },
    });
  } catch (error) { next(error); }
};

// ========== ADMIN: APPROVE / REJECT WITHDRAWALS ==========
exports.approveWithdrawal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { transactionId } = req.body;
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal || withdrawal.status !== 'pending') return next(new AppError('Invalid request', 400));
    withdrawal.status = 'approved';
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();
    await Transaction.findByIdAndUpdate(withdrawal.transaction, { status: 'completed' });
    await Notification.create({
      user: withdrawal.user,
      type: 'payment',
      title: 'Withdrawal Approved ✅',
      message: withdrawal.amount + ' ETB withdrawal approved.',
      priority: 'high',
    });
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
};

exports.rejectWithdrawal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal || withdrawal.status !== 'pending') return next(new AppError('Invalid request', 400));
    const user = await User.findById(withdrawal.user);
    user.walletBalance += withdrawal.amount;
    await user.save();
    withdrawal.reviewNote = note || 'Rejected';
    withdrawal.status = 'rejected';
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();
    await Transaction.findByIdAndUpdate(withdrawal.transaction, { status: 'reversed' });
    await Transaction.create({
      userId: withdrawal.user,
      type: 'refund',
      amount: withdrawal.amount,
      balanceBefore: user.walletBalance - withdrawal.amount,
      balanceAfter: user.walletBalance,
      direction: 'credit',
      status: 'completed',
      performedBy: req.user._id,
      description: 'Withdrawal rejected - Refund',
    });
    await Notification.create({
      user: withdrawal.user,
      type: 'payment',
      title: 'Withdrawal Returned ↩️',
      message: withdrawal.amount + ' ETB returned.',
      priority: 'high',
    });
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
};

// ========== SEED ==========
exports.seedPaymentAccounts = async (req, res, next) => {
  try {
    const existing = await PaymentAccount.countDocuments();
    if (existing > 0) return res.status(200).json({ success: true, message: 'Already seeded', count: existing });
    await PaymentAccount.insertMany([
      {
        type: 'telebirr',
        accountName: 'Bingo Gaming PLC',
        phone: '+251912345678',
        displayOrder: 1,
        instructionsEn: '1. Open Telebirr\n2. Send to +251912345678\n3. Enter amount\n4. Copy transaction ID',
        instructionsAm: '1. ቴሌብር ይክፈቱ\n2. ወደ +251912345678 ይላኩ\n3. መጠኑን ያስገቡ\n4. ኮዱን ይቅዱ',
        instructionsTg: '1. ቴሌብር ክፈቱ\n2. ናብ +251912345678 ልኣኹ\n3. መጠን ኣእቱ\n4. ኮድ ቅድሕ',
        minDeposit: 50, maxDeposit: 50000,
      },
      {
        type: 'cbe',
        accountName: 'Bingo Gaming PLC',
        accountNumber: '1000123456789',
        displayOrder: 2,
        instructionsEn: '1. Go to CBE Birr or branch\n2. Deposit to 1000123456789\n3. Save reference number',
        instructionsAm: '1. ወደ ሲቢኢ ብር ይሂዱ\n2. ወደ 1000123456789 ያስገቡ\n3. ማመሳከሪያ ያስቀምጡ',
        instructionsTg: '1. ናብ ሲቢኢ ኪድ\n2. ናብ 1000123456789 ኣእቱ\n3. መወከሲ ኣቐምጥ',
        minDeposit: 50, maxDeposit: 50000,
      },
    ]);
    res.status(201).json({ success: true, message: 'Seed data created' });
  } catch (error) { next(error); }
};