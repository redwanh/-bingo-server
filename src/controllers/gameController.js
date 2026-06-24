const GameConfig = require('../models/GameConfig');
const Game = require('../models/Game');
const Card = require('../models/Card');
const Transaction = require('../models/Transaction');

exports.getConfig = async (req, res) => {
  const config = await GameConfig.findOne({ roomId: req.params.roomId });
  res.json(config || {});
};

exports.updateConfig = async (req, res) => {
  const config = await GameConfig.findOneAndUpdate(
    { roomId: req.params.roomId }, req.body, { new: true, upsert: true }
  );
  res.json({ success: true, config });
};
// Add this new endpoint
exports.getPreviewCards = async (req, res) => {
  try {
    const Card = require('../models/Card');
    const Game = require('../models/Game');
    
    const game = await Game.getActiveGame(req.params.roomId);
    if (!game) return res.json({ cards: [] });
    
    const previewCards = await Card.find({ 
      gameId: game._id, 
      userId: req.user.id, 
      status: 'preview' 
    });
    
    res.json({ cards: previewCards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getGameState = async (req, res) => {
  const engine = req.app.get('gameEngine');
  const state = await engine.getGameState(req.params.roomId, req.user.id);
  res.json(state);
};

exports.buyCard = async (req, res) => {
  try {
    const engine = req.app.get('gameEngine');
    const result = await engine.buyCard(req.params.roomId, req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

// NEW: Bulk buy cards
exports.buyCards = async (req, res) => {
  try {
    const engine = req.app.get('gameEngine');
    const { quantity } = req.body;
    const result = await engine.buyCards(req.params.roomId, req.user.id, quantity || 1);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.callBingo = async (req, res) => {
  try {
    const engine = req.app.get('gameEngine');
    const result = await engine.callBingo(req.params.roomId, req.user.id, req.body.cardId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.markNumber = async (req, res) => {
  const { cardId, number, letter } = req.body;
  const card = await Card.findOne({ _id: cardId, userId: req.user.id });
  if (!card || card.isBlocked) return res.status(400).json({ error: 'Invalid card' });
  const cell = card.grid[letter]?.find(c => c.number === number);
  if (cell) { cell.isMarked = !cell.isMarked; await card.save(); }
  res.json({ success: true, isMarked: cell?.isMarked });
};

exports.getHistory = async (req, res) => {
  const games = await Game.find({ roomId: req.params.roomId, status: 'completed' })
    .sort({ endTime: -1 }).limit(20)
    .select('gameId gameNumber prizePool winners playerCount totalCards endTime commission');
  res.json(games);
};

exports.getTransactions = async (req, res) => {
  const txns = await Transaction.find({ userId: req.user.id })
    .sort({ createdAt: -1 }).limit(50);
  res.json(txns);
};
