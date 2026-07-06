const MainBingoConfig = require('../models/MainBingoConfig');
const MainBingoGame = require('../models/MainBingoGame');
const MainBingoRule = require('../models/MainBingoRule');
const Card = require('../models/Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const ROOM = 'main-bingo-room'; // 🔧 Define room constant

// Helper to emit to main bingo room only
const emitToRoom = (io, event, data) => {
  if (io) io.to(ROOM).emit(event, data);
};

exports.setupGame = async (req, res) => {
  try {
    const { 
      ruleId, cardPrice, maxCardsPerPlayer,
      callIntervalSeconds, gameStartingSeconds, gracePeriodSeconds,
      isLastNumberCalledBingo, noOfPlayersToStart, minimumCardsToStart, minimumPrizeThreshold
    } = req.body;
    
    await MainBingoConfig.updateMany({ status: 'setup' }, { status: 'completed' });
    const rule = await MainBingoRule.findById(ruleId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    const config = await MainBingoConfig.create({ 
      ruleId, 
      ruleName: rule.name, 
      cardPrice, 
      maxCardsPerPlayer: maxCardsPerPlayer || 10,
      callIntervalSeconds: callIntervalSeconds || 5,
      gameStartingSeconds: gameStartingSeconds || 30,
      gracePeriodSeconds: gracePeriodSeconds || 10,
      isLastNumberCalledBingo: isLastNumberCalledBingo || false,
      noOfPlayersToStart: noOfPlayersToStart || 2,
      minimumCardsToStart: minimumCardsToStart || 1,
      minimumPrizeThreshold: minimumPrizeThreshold || 100,
      createdBy: req.user.id 
    });
    
    const lastNum = await MainBingoGame.getLatestGameNumber();
    const nums = []; for (let i = 1; i <= 75; i++) nums.push(i);
    for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; }
    const game = await MainBingoGame.create({ gameId: String(lastNum + 1).padStart(10, '0'), gameNumber: lastNum + 1, configId: config._id, ruleId, status: 'setup', allNumbers: nums });
    
    // ✅ USE EXISTING POOL CARDS (don't create new ones)
    const availableCount = await Card.countDocuments({ 
      gameId: null, userId: null, status: 'preview' 
    });
    console.log(`🎫 ${availableCount} cards available in main bingo pool`);
    await game.save();
    
    const io = req.app.get('io');
// 🔥 Emit unified gameState to all players in room
const state = await exports.getStateForSocket(null);
state.active = true;
state.game = game;
state.config = config;
state.rule = rule;
state.myCards = [];
// 🔥 Don't set balance to 0 - remove or skip it
delete state.balance;  // ← ADD THIS
io.to(ROOM).emit('gameState', state);
console.log('📡 Emitted gameState for new game setup');
res.json({ success: true, config, game });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.setPrize = async (req, res) => {
  try {
    const { prizeAmount } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game) return res.status(404).json({ error: 'No active game' });
    
    game.prizeAmount = prizeAmount;
    await game.save();
    await MainBingoConfig.findByIdAndUpdate(game.configId, { prizeAmount });
    
    // 🔥 Emit ONLY prize update, not full gameState
    const io = req.app.get('io');
    io.to(ROOM).emit('mainBingoPrizeSet', { prizeAmount });
    console.log('📡 Prize updated:', prizeAmount);
    
    res.json({ success: true, prizeAmount });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.startGame = async (req, res) => {
  try {
    console.log('🚀 START GAME endpoint hit');
    
    const game = await MainBingoGame.getActiveGame();
    if (!game) return res.status(404).json({ error: 'No active game' });
    if (game.status !== 'setup') return res.status(400).json({ error: 'Game already started' });
    
    // 🔥 Get countdown from admin config
    const config = await MainBingoConfig.findById(game.configId);
    const countdownSeconds = config?.gameStartingSeconds || config?.countdownSeconds || 30;
    
    game.status = 'countdown';
    game.countdownStartedAt = new Date();
    game.countdownEndTime = new Date(Date.now() + countdownSeconds * 1000); // Absolute timestamp
    await game.save();
    await MainBingoConfig.findByIdAndUpdate(game.configId, { status: 'countdown' });
    
    const io = req.app.get('io');
    
    if (io) {
      console.log(`📡 Emitting mainBingoCountdown: ${countdownSeconds}s`);
      // 🔥 Send absolute end time, not seconds
      io.to(ROOM).emit('mainBingoCountdown', { 
        seconds: countdownSeconds,
        endTime: game.countdownEndTime // Absolute timestamp
      });
    }
    
    // 🔥 Engine handles the actual game start after countdown
    const mainBingoEngine = req.app.get('mainBingoEngine');
    setTimeout(async () => {
      try {
        const current = await MainBingoGame.findById(game._id);
        if (!current || current.status !== 'countdown') return;
        
        current.status = 'in_progress';
        current.startTime = new Date();
        await current.save();
        await MainBingoConfig.findByIdAndUpdate(current.configId, { status: 'in_progress', startedAt: new Date() });
        
        // 🔥 Emit game started
        io.to(ROOM).emit('mainBingoStarted', { game: current });
        
        // 🔥 Engine handles drawing
        mainBingoEngine.drawNumbers(current);
        
      } catch (err) {
        console.error('❌ Game start error:', err);
      }
    }, countdownSeconds * 1000);
    
    res.json({ success: true, message: `Game starting in ${countdownSeconds} seconds` });
    
  } catch (e) {
    console.error('❌ startGame error:', e);
    res.status(400).json({ error: e.message });
  }
};

exports.buyCards = async (req, res) => {
  try {
    const { quantity } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
      return res.status(400).json({ error: 'Game not available' });
    }
    
    const config = await MainBingoConfig.findById(game.configId);
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    const currentCards = player?.cards.length || 0;
    const maxAllowed = config.maxCardsPerPlayer - currentCards;
    
    if (quantity > maxAllowed) return res.status(400).json({ error: 'Max ' + maxAllowed + ' more cards' });
    
    const totalCost = config.cardPrice * quantity;
    const user = await User.findById(req.user.id);
    
    if ((user.balance || 0) < totalCost) return res.status(400).json({ error: 'Insufficient balance' });
    
    user.balance -= totalCost;
    await user.save();
    
    // ✅ Take cards from pool instead of creating new ones
    const availableCards = await Card.find({ 
      gameId: null, userId: null, status: 'preview' 
    }).limit(quantity);
    
    if (availableCards.length < quantity) {
      return res.status(400).json({ error: `Only ${availableCards.length} cards left in pool` });
    }
    
    const cardIds = availableCards.map(c => c._id);
    await Card.updateMany(
      { _id: { $in: cardIds } }, 
      { $set: { gameId: game._id, userId: req.user.id, status: 'preview', price: config.cardPrice } }
    );
    
    const cards = await Card.find({ _id: { $in: cardIds } });
    
    if (!player) game.players.push({ userId: req.user.id, cards: cards.map(c => c._id) });
    else player.cards.push(...cards.map(c => c._id));
    game.totalCards += quantity;
    await game.save();
    
    const io = req.app.get('io');
    emitToRoom(io, 'mainBingoCardsUpdated', { playerCount: game.players.length, totalCards: game.totalCards }); // 🔧 FIXED
    
    res.json({ success: true, cards, balance: user.balance, cardsOwned: currentCards + quantity });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.topupBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.id);
    user.balance = (user.balance || 0) + (amount * 100);
    await user.save();
    console.log(`💰 Topup: ${amount} ETB for ${user.phone}, new balance: ${user.balance}`);
    res.json({ success: true, balance: user.balance, balanceETB: (user.balance / 100).toFixed(2) });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getState = async (req, res) => {
  try {
    const game = await MainBingoGame.getActiveGame();
    if (!game) return res.json({ active: false, message: 'No active game' });

    const rule = await MainBingoRule.findById(game.ruleId)
  .select('name nameAmharic nameTigrinya nameOromo nameChinese nameEnglish description descriptionAmharic descriptionTigrinya descriptionOromo descriptionChinese descriptionEnglish method ruleConfig patterns');

    const config = await MainBingoConfig.findById(game.configId);
    const myCards = await Card.find({ gameId: game._id, userId: req.user.id });
    const user = await User.findById(req.user.id || req.user._id);
    const registeredCards = await Card.countDocuments({ gameId: game._id, status: 'registered' });

    res.json({
      active: true, gameId: game._id,
      game: { _id: game._id, status: game.status, prizeAmount: game.prizeAmount, drawnNumbers: game.drawnNumbers || [], startTime: game.startTime, gracePeriodEndTime: game.gracePeriodEndTime },
      config: { cardPrice: config?.cardPrice || 0, maxCardsPerPlayer: config?.maxCardsPerPlayer || 10, countdownSeconds: config?.countdownSeconds || 30, callIntervalSeconds: config?.callIntervalSeconds || 5, gracePeriodSeconds: config?.gracePeriodSeconds || 10 },
      rule: {
        _id: rule?._id, name: rule?.name, description: rule?.description, method: rule?.method, ruleConfig: rule?.ruleConfig, patterns: rule?.patterns || [],
        nameAmharic: rule?.nameAmharic || '', nameTigrinya: rule?.nameTigrinya || '', nameOromo: rule?.nameOromo || '', nameChinese: rule?.nameChinese || '', nameEnglish: rule?.nameEnglish || '',
        descriptionAmharic: rule?.descriptionAmharic || '', descriptionTigrinya: rule?.descriptionTigrinya || '', descriptionOromo: rule?.descriptionOromo || '', descriptionChinese: rule?.descriptionChinese || '', descriptionEnglish: rule?.descriptionEnglish || '',
        samples: { wins: (rule?.samples?.wins || []).slice(0, 3).map(s => ({ markedCells: s.markedCells, isValid: s.isValid, details: s.details })), losses: (rule?.samples?.losses || []).slice(0, 3).map(s => ({ markedCells: s.markedCells, isValid: s.isValid, details: s.details })) },
      },
      myCards: myCards || [], balance: user?.walletBalance || user?.balance || 0, totalCards: registeredCards,
      playerCount: await Card.distinct('userId', { gameId: game._id, status: 'registered' }).then(r => r.length),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.registerCards = async (req, res) => {
  try {
    const { cardIds } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) return res.status(400).json({ error: 'Game not accepting registrations' });
    
    const config = await MainBingoConfig.findById(game.configId);
    const user = await User.findById(req.user.id);
    const cards = await Card.find({ _id: { $in: cardIds }, userId: req.user.id, gameId: game._id, status: 'preview' });
    
    if (cards.length !== cardIds.length) return res.status(400).json({ error: 'Some cards not available' });
    
    const totalCost = config.cardPrice * cards.length;
    if ((user.walletBalance || user.balance || 0) < totalCost) return res.status(400).json({ error: 'Insufficient balance' });
    
    if (user.walletBalance !== undefined) user.walletBalance -= totalCost;
    else user.balance -= totalCost;
    await user.save();
    
    await Card.updateMany({ _id: { $in: cardIds } }, { $set: { status: 'registered' } });
    game.totalCards = (game.totalCards || 0) + cards.length;
    await game.save();
    
    res.json({ success: true, balance: user.walletBalance || user.balance, registeredCount: cards.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.pickCards = async (req, res) => {
  try {
    const { quantity } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) 
      return res.status(400).json({ error: 'Game not available' });
    
    const config = await MainBingoConfig.findById(game.configId);
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    const currentCards = player?.cards.length || 0;
    const maxAllowed = config.maxCardsPerPlayer - currentCards;
    
    if (quantity > maxAllowed) 
      return res.status(400).json({ error: `Max ${maxAllowed} more cards` });
    
    // ✅ RANDOM & FAST: Use MongoDB aggregation with $sample
    const availableCards = await Card.aggregate([
      { $match: { gameId: null, userId: null, status: 'preview' } },
      { $sample: { size: quantity } }
    ]);
    
    if (availableCards.length < quantity) 
      return res.status(400).json({ error: `Only ${availableCards.length} cards left` });

    const cardIds = availableCards.map(c => c._id);
    
    await Card.updateMany(
      { _id: { $in: cardIds } }, 
      { $set: { gameId: game._id, userId: req.user.id, status: 'preview' } }
    );
    
    const cards = await Card.find({ _id: { $in: cardIds } });
    
    if (!player) game.players.push({ userId: req.user.id, cards: cardIds });
    else player.cards.push(...cardIds);
    await game.save();
    
    res.json({ success: true, cards, cardsOwned: currentCards + quantity });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getMonitor = async (req, res) => {
  const game = await MainBingoGame.getActiveGame();
  if (!game) return res.json({ active: false });
  
  const config = await MainBingoConfig.findById(game.configId).populate('ruleId');
  const totalPicked = await Card.countDocuments({ gameId: game._id });
  const registeredCards = await Card.countDocuments({ gameId: game._id, status: 'registered' });
  const registeredPlayers = await Card.distinct('userId', { gameId: game._id, status: 'registered' });
  
  res.json({ active: true, game, config, rule: config?.ruleId, totalPicked, totalSold: registeredCards, playerCount: registeredPlayers.length, totalCards: game.totalCards });
};
// 🔥 Socket-friendly state getter (no req/res needed)
exports.getStateForSocket = async (userId) => {
  try {
    const MainBingoGame = require('../models/MainBingoGame');
    const MainBingoRule = require('../models/MainBingoRule');
    const MainBingoConfig = require('../models/MainBingoConfig');
    const Card = require('../models/Card');
    const User = require('../models/User');
    
    const game = await MainBingoGame.getActiveGame();
    if (!game) return { active: false, message: 'No active game' };

    const rule = await MainBingoRule.findById(game.ruleId)
      .select('name description method ruleConfig patterns');
    const config = await MainBingoConfig.findById(game.configId);
    
    // Get ALL user's cards for this game (both preview and registered)
    const myCards = await Card.find({ gameId: game._id, userId });
    
    // 🔍 DEBUG
    console.log(`🔍 [getStateForSocket] Game: ${game._id}, User: ${userId}`);
    console.log(`🔍 [getStateForSocket] Cards found: ${myCards.length}`);
    myCards.forEach(c => console.log(`   Card: ${c._id} | displayId: ${c.displayId} | status: ${c.status} | gameId: ${c.gameId} | userId: ${c.userId}`));
    
    const user = await User.findById(userId);

    return {
      active: true,
      gameId: game._id,
      game: {
        _id: game._id,
        status: game.status,
        prizeAmount: game.prizeAmount,
        drawnNumbers: game.drawnNumbers || [],
        startTime: game.startTime,
        gracePeriodEndTime: game.gracePeriodEndTime,
        gameNumber: game.gameNumber
      },
      config: {
        cardPrice: config?.cardPrice || 0,
        maxCardsPerPlayer: config?.maxCardsPerPlayer || 10,
        countdownSeconds: config?.countdownSeconds || 30,
        callIntervalSeconds: config?.callIntervalSeconds || 5,
        gracePeriodSeconds: config?.gracePeriodSeconds || 10
      },
     rule: rule ? {
    _id: rule._id,
    name: rule.name,
    nameAmharic: rule.nameAmharic || '',
    nameTigrinya: rule.nameTigrinya || '',
    nameOromo: rule.nameOromo || '',
    nameChinese: rule.nameChinese || '',
    nameEnglish: rule.nameEnglish || '',
    description: rule.description,
    descriptionAmharic: rule.descriptionAmharic || '',
    descriptionTigrinya: rule.descriptionTigrinya || '',
    descriptionOromo: rule.descriptionOromo || '',
    descriptionChinese: rule.descriptionChinese || '',
    descriptionEnglish: rule.descriptionEnglish || '',
    method: rule.method,
    ruleConfig: rule.ruleConfig,
    patterns: rule.patterns || []
} : null,
      myCards: myCards || [],
      balance: user?.walletBalance || user?.balance || 0,
      totalCards: await Card.countDocuments({ gameId: game._id, status: 'registered' }),
      playerCount: await Card.distinct('userId', { gameId: game._id, status: 'registered' }).then(r => r.length)
    };
  } catch (e) {
    console.error('getStateForSocket error:', e);
    return { active: false, message: 'Error: ' + e.message };
  }
};
function genCol(min, max) { 
  const s = new Set(); 
  while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min); 
  return Array.from(s).map(n => ({ number: n, isMarked: false })); 
}