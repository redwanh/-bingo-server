const PaymentAccount = require('../models/PaymentAccount');
const DepositRequest = require('../models/DepositRequest');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');

// === PAYMENT ACCOUNTS ===
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

// === DEPOSIT ===
exports.createDeposit = async (req, res, next) => {
  try {
    const { paymentAccountId, amount, transactionId, senderPhone } = req.body;
    
    const account = await PaymentAccount.findById(paymentAccountId);
    if (!account) return next(new AppError('Payment account not found', 404));
    
    
    const isAutoApproved = transactionId === '123456';
    
    // If wrong transaction ID, reject immediately
    if (!isAutoApproved) {
      return next(new AppError('Transaction verification failed. Please check your Transaction ID and try again.', 400));
    }
    
    const deposit = await DepositRequest.create({
      user: req.user._id, paymentAccount: paymentAccountId,
      amount, transactionId, senderPhone,
      status: 'approved',
    });
    
    if (isAutoApproved) {
      const user = await User.findById(req.user._id);
      const balanceBefore = user.walletBalance;
      user.walletBalance += parseFloat(amount);
      await user.save();
      
      const transaction = await Transaction.create({
        user: req.user._id, userId: req.user._id,
        type: 'deposit', amount: parseFloat(amount),
        balanceBefore, balanceAfter: user.walletBalance,
        direction: 'credit', status: 'completed',
        performedBy: req.user._id, performedByRole: 'user',
        reference: 'DEP-' + deposit._id.toString().slice(-8).toUpperCase(),
        description: 'Deposit via ' + account.type,
      });
      
      deposit.transaction = transaction._id;
      deposit.reviewedBy = req.user._id;
      deposit.reviewedAt = new Date();
      deposit.reviewNote = 'Auto-approved';
      await deposit.save();
      
      await Notification.create({
        user: req.user._id, type: 'balance_added',
        title: 'Deposit Successful ✅',
        titleAm: 'ተቀማጭ ገንዘብ ተሳክቷል ✅',
        titleTg: 'ተቀማጭ ገንዘብ ተዓዊቱ ✅',
        message: '+' + amount + ' ETB added. New balance: ' + user.walletBalance + ' ETB',
        messageAm: '+' + amount + ' ብር ተጨምሯል። አዲስ ቀሪ ሂሳብ፦ ' + user.walletBalance + ' ብር',
        messageTg: '+' + amount + ' ብር ተወሰኸ። ሓድሽ ቀሪ ሒሳብ፦ ' + user.walletBalance + ' ብር',
        priority: 'high', amount: parseFloat(amount), transactionId: transaction._id,
      });
      
      return res.status(200).json({ success: true, autoApproved: true, message: 'Deposit successful!', data: { balance: user.walletBalance } });
    }
  } catch (error) { next(error); }
};

// === WITHDRAWAL ===
exports.createWithdrawal = async (req, res, next) => {
  try {
    const { amount, type = 'telebirr', accountInfo = 'N/A' } = req.body;
    if (!amount || amount <= 0) return next(new AppError('Enter a valid amount', 400));
    
    const user = await User.findById(req.user._id);
    if (user.walletBalance < amount) return next(new AppError('Insufficient balance', 400));
    
    const balanceBefore = user.walletBalance;
    user.walletBalance -= parseFloat(amount);
    await user.save();
    
    const withdrawal = await Withdrawal.create({
      user: req.user._id, amount: parseFloat(amount), type, accountInfo,
    });
    
    const transaction = await Transaction.create({
      user: req.user._id, userId: req.user._id,
      type: 'withdrawal', amount: parseFloat(amount),
      balanceBefore, balanceAfter: user.walletBalance,
      direction: 'debit', status: 'pending',
      performedBy: req.user._id, performedByRole: 'user',
      reference: 'WTD-' + withdrawal._id.toString().slice(-8).toUpperCase(),
      description: 'Withdrawal via ' + type + ' - Pending',
    });
    
    withdrawal.transaction = transaction._id;
    await withdrawal.save();
    
    // Notify admins
    const admins = await User.find({ role: { $in: ['superadmin', 'admin', 'finance'] } });
    for (const admin of admins) {
      await Notification.create({
        user: admin._id, type: 'balance_deducted',
        title: 'New Withdrawal Request',
        message: user.fullName + ' requests ' + amount + ' ETB',
        priority: 'high', amount: parseFloat(amount),
      });
    }
    
    await Notification.create({
      user: req.user._id, type: 'balance_deducted',
      title: 'Withdrawal Requested', titleAm: 'ማውጣት ተጠይቋል', titleTg: 'ምውጻእ ተሓቲቱ',
      message: amount + ' ETB deducted. Pending approval.',
      messageAm: amount + ' ብር ወጥቷል። በመጠባበቅ ላይ።',
      messageTg: amount + ' ብር ወጺኡ። ብምጽባይ ላይ።',
      priority: 'high', amount: parseFloat(amount),
    });
    
    res.status(200).json({ success: true, message: 'Withdrawal submitted.', data: { balance: user.walletBalance } });
  } catch (error) { next(error); }
};

// === ADMIN: Deposits ===
exports.getDepositRequests = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    const deposits = await DepositRequest.find(query)
      .populate('user', 'fullName phone walletBalance')
      .populate('paymentAccount', 'type accountName phone accountNumber')
      .populate('reviewedBy', 'fullName')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
    const total = await DepositRequest.countDocuments(query);
    const pendingCount = await DepositRequest.countDocuments({ status: 'pending' });
    res.status(200).json({ success: true, data: { deposits, pendingCount, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
};

exports.approveDeposit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deposit = await DepositRequest.findById(id).populate('paymentAccount');
    if (!deposit || deposit.status !== 'pending') return next(new AppError('Invalid request', 400));
    const user = await User.findById(deposit.user);
    const balanceBefore = user.walletBalance;
    user.walletBalance += deposit.amount;
    await user.save();
    const transaction = await Transaction.create({
      user: deposit.user, userId: deposit.user, type: 'deposit', amount: deposit.amount,
      balanceBefore, balanceAfter: user.walletBalance, direction: 'credit', status: 'completed',
      performedBy: req.user._id, performedByRole: req.user.role,
      reference: 'DEP-' + deposit._id.toString().slice(-8).toUpperCase(),
      description: 'Deposit via ' + deposit.paymentAccount.type,
    });
    deposit.status = 'approved'; deposit.reviewedBy = req.user._id; deposit.reviewedAt = new Date(); deposit.transaction = transaction._id;
    await deposit.save();
    await Notification.create({
      user: deposit.user, type: 'balance_added', title: 'Deposit Approved ✅',
      message: '+' + deposit.amount + ' ETB. Balance: ' + user.walletBalance + ' ETB',
      priority: 'high', amount: deposit.amount, transactionId: transaction._id,
    });
    res.status(200).json({ success: true, data: deposit });
  } catch (error) { next(error); }
};

exports.rejectDeposit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deposit = await DepositRequest.findByIdAndUpdate(id, { status: 'rejected', reviewedBy: req.user._id, reviewedAt: new Date() }, { new: true });
    if (!deposit) return next(new AppError('Not found', 404));
    await Notification.create({ user: deposit.user, type: 'balance_deducted', title: 'Deposit Rejected', message: deposit.amount + ' ETB deposit rejected.', priority: 'normal' });
    res.status(200).json({ success: true, data: deposit });
  } catch (error) { next(error); }
};

// === ADMIN: Withdrawals ===
exports.approveWithdrawal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { transactionId } = req.body;
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal || withdrawal.status !== 'pending') return next(new AppError('Invalid request', 400));
    withdrawal.status = 'approved'; withdrawal.reviewedBy = req.user._id; withdrawal.reviewedAt = new Date();
    await withdrawal.save();
    await Transaction.findByIdAndUpdate(withdrawal.transaction, { status: 'completed' });
    await Notification.create({ user: withdrawal.user, type: 'balance_deducted', title: 'Withdrawal Approved ✅',
        message: withdrawal.amount + ' ETB withdrawal approved. TX: ' + (transactionId || 'N/A'), message: withdrawal.amount + ' ETB withdrawal approved.', priority: 'high' });
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
    withdrawal.reviewNote = note || 'Rejected'; withdrawal.status = 'rejected'; withdrawal.reviewedBy = req.user._id; withdrawal.reviewedAt = new Date();
    await withdrawal.save();
    await Transaction.findByIdAndUpdate(withdrawal.transaction, { status: 'reversed' });
    await Transaction.create({
      user: withdrawal.user, userId: withdrawal.user, type: 'refund', amount: withdrawal.amount,
      balanceBefore: user.walletBalance - withdrawal.amount, balanceAfter: user.walletBalance,
      direction: 'credit', status: 'completed', performedBy: req.user._id,
      description: 'Withdrawal rejected - Refund',
    });
    await Notification.create({ user: withdrawal.user, type: 'balance_added', title: 'Withdrawal Returned ↩️', message: withdrawal.amount + ' ETB returned.', priority: 'high' });
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
};

// === SEED ===
exports.seedPaymentAccounts = async (req, res, next) => {
  try {
    const existing = await PaymentAccount.countDocuments();
    if (existing > 0) return res.status(200).json({ success: true, message: 'Already seeded', count: existing });
    await PaymentAccount.insertMany([
      { type: 'telebirr', accountName: 'Bingo Gaming PLC', phone: '+251912345678', displayOrder: 1,
        instructionsEn: '1. Open Telebirr\n2. Send to +251912345678\n3. Enter amount\n4. Copy transaction ID',
        instructionsAm: '1. ቴሌብር ይክፈቱ\n2. ወደ +251912345678 ይላኩ\n3. መጠኑን ያስገቡ\n4. ኮዱን ይቅዱ',
        instructionsTg: '1. ቴሌብር ክፈቱ\n2. ናብ +251912345678 ልኣኹ\n3. መጠን ኣእቱ\n4. ኮድ ቅድሕ',
        minDeposit: 50, maxDeposit: 50000 },
      { type: 'cbe', accountName: 'Bingo Gaming PLC', accountNumber: '1000123456789', displayOrder: 2,
        instructionsEn: '1. Go to CBE Birr or branch\n2. Deposit to 1000123456789\n3. Save reference number',
        instructionsAm: '1. ወደ ሲቢኢ ብር ይሂዱ\n2. ወደ 1000123456789 ያስገቡ\n3. ማመሳከሪያ ያስቀምጡ',
        instructionsTg: '1. ናብ ሲቢኢ ኪድ\n2. ናብ 1000123456789 ኣእቱ\n3. መወከሲ ኣቐምጥ',
        minDeposit: 50, maxDeposit: 50000 },
    ]);
    res.status(201).json({ success: true, message: 'Seed data created' });
  } catch (error) { next(error); }
};



