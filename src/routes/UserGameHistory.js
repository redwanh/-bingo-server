const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Game = require('../models/Game');
const User = require('../models/User');
const mongoose = require('mongoose');

// ============================================
// GET /api/user-game-history/all
// ============================================
router.get('/all', protect, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const games = await Game.find({})
            .sort({ endTime: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Game.countDocuments({});

        const formattedGames = games.map(game => ({
            _id: game._id,
            gameId: game.gameId,
            gameNumber: game.gameNumber,
            roomId: game.roomId,
            status: game.status,
            prizePool: game.prizePool || 0,
            totalCards: game.totalCards || 0,
            playerCount: game.players?.length || 0,
            winners: game.winners || [],
            winnerCount: game.winners?.length || 0,
            startTime: game.startTime,
            endTime: game.endTime,
            createdAt: game.createdAt
        }));

        res.json({
            success: true,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            },
            games: formattedGames
        });
    } catch (error) {
        console.error('Error in /all:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// GET /api/user-game-history/user/:userId
// NUCLEAR SOLUTION - Multiple query attempts
// ============================================
router.get('/user/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log('🔍 1. Received userId:', userId);

        // ✅ Method 1: Try direct string query
        console.log('📌 Method 1: Direct string query');
        let games = await Game.find({
            'players.userId': userId,
            status: 'completed'
        })
        .sort({ endTime: -1, createdAt: -1 })
        .limit(20)
        .lean();

        console.log('📊 Method 1 result:', games.length);

        // ✅ Method 2: If no results, try with ObjectId
        if (games.length === 0) {
            console.log('📌 Method 2: Trying with ObjectId');
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                games = await Game.find({
                    'players.userId': objectId,
                    status: 'completed'
                })
                .sort({ endTime: -1, createdAt: -1 })
                .limit(20)
                .lean();
                console.log('📊 Method 2 result:', games.length);
            } catch (e) {
                console.log('⚠️ Method 2 failed:', e.message);
            }
        }

        // ✅ Method 3: Try with $in (array of both formats)
        if (games.length === 0) {
            console.log('📌 Method 3: Trying with $in');
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                games = await Game.find({
                    'players.userId': { $in: [userId, objectId] },
                    status: 'completed'
                })
                .sort({ endTime: -1, createdAt: -1 })
                .limit(20)
                .lean();
                console.log('📊 Method 3 result:', games.length);
            } catch (e) {
                console.log('⚠️ Method 3 failed:', e.message);
            }
        }

        // ✅ Method 4: Try with $elemMatch
        if (games.length === 0) {
            console.log('📌 Method 4: Trying with $elemMatch');
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                games = await Game.find({
                    players: { $elemMatch: { userId: objectId } },
                    status: 'completed'
                })
                .sort({ endTime: -1, createdAt: -1 })
                .limit(20)
                .lean();
                console.log('📊 Method 4 result:', games.length);
            } catch (e) {
                console.log('⚠️ Method 4 failed:', e.message);
            }
        }

        // ✅ If still no games, return empty array (not error)
        console.log('✅ Final games count:', games.length);

        // Get user info
        let user = null;
        try {
            user = await User.findById(userId).select('fullName phone username');
        } catch (e) {
            console.log('⚠️ User fetch failed:', e.message);
            // Try with ObjectId
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                user = await User.findById(objectId).select('fullName phone username');
            } catch (e2) {
                console.log('⚠️ User fetch with ObjectId also failed:', e2.message);
            }
        }

        // Build response
        const history = games.map(game => {
            const userWins = (game.winners || []).filter(w => {
                const wid = w.userId?.toString() || w.userId?._id?.toString() || '';
                return wid === userId;
            });

            return {
                gameId: game.gameId || 'N/A',
                gameNumber: game.gameNumber || 0,
                status: game.status || 'unknown',
                prizePool: game.prizePool || 0,
                playerCount: game.players?.length || 0,
                endTime: game.endTime,
                createdAt: game.createdAt,
                isWinner: userWins.length > 0,
                wonAmount: userWins.reduce((sum, w) => sum + (w.prizeAmount || 0), 0)
            };
        });

        const stats = {
            totalGames: games.length,
            gamesWon: history.filter(g => g.isWinner).length,
            totalWon: history.reduce((sum, g) => sum + (g.wonAmount || 0), 0),
            winRate: games.length > 0 ? (history.filter(g => g.isWinner).length / games.length) * 100 : 0
        };

        res.json({
            success: true,
            user: user ? {
                _id: user._id,
                fullName: user.fullName || 'Unknown',
                phone: user.phone || 'N/A',
                username: user.username || 'N/A'
            } : {
                _id: userId,
                fullName: 'Unknown User',
                phone: 'N/A',
                username: 'N/A'
            },
            stats,
            history
        });
    } catch (error) {
        console.error('❌ CRITICAL ERROR in /user:', error);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: error.message,
            stack: error.stack
        });
    }
});

// ============================================
// GET /api/user-game-history/stats/:userId
// ============================================
router.get('/stats/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log('📊 Stats for user:', userId);

        // Try multiple query methods
        let games = [];

        // Method 1: String
        games = await Game.find({
            'players.userId': userId,
            status: 'completed'
        }).lean();

        // Method 2: ObjectId if no results
        if (games.length === 0) {
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                games = await Game.find({
                    'players.userId': objectId,
                    status: 'completed'
                }).lean();
            } catch (e) {}
        }

        let totalGames = games.length;
        let gamesWon = 0;
        let totalWon = 0;

        games.forEach(game => {
            const userWins = (game.winners || []).filter(w => {
                const wid = w.userId?.toString() || w.userId?._id?.toString() || '';
                return wid === userId;
            });
            if (userWins.length > 0) {
                gamesWon++;
                totalWon += userWins.reduce((sum, w) => sum + (w.prizeAmount || 0), 0);
            }
        });

        res.json({
            success: true,
            stats: {
                totalGames,
                gamesWon,
                totalWon,
                winRate: totalGames > 0 ? (gamesWon / totalGames) * 100 : 0
            }
        });
    } catch (error) {
        console.error('Error in /stats:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// GET /api/user-game-history/recent/:userId
// ============================================
router.get('/recent/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        const limit = parseInt(req.query.limit) || 10;
        console.log('📋 Recent games for user:', userId);

        // Try multiple query methods
        let games = [];

        // Method 1: String
        games = await Game.find({
            'players.userId': userId
        })
        .sort({ endTime: -1, createdAt: -1 })
        .limit(limit)
        .lean();

        // Method 2: ObjectId if no results
        if (games.length === 0) {
            try {
                const objectId = new mongoose.Types.ObjectId(userId);
                games = await Game.find({
                    'players.userId': objectId
                })
                .sort({ endTime: -1, createdAt: -1 })
                .limit(limit)
                .lean();
            } catch (e) {}
        }

        const history = games.map(game => {
            const userWins = (game.winners || []).filter(w => {
                const wid = w.userId?.toString() || w.userId?._id?.toString() || '';
                return wid === userId;
            });

            return {
                gameId: game.gameId || 'N/A',
                gameNumber: game.gameNumber || 0,
                status: game.status || 'unknown',
                prizePool: game.prizePool || 0,
                playerCount: game.players?.length || 0,
                endTime: game.endTime,
                createdAt: game.createdAt,
                isWinner: userWins.length > 0,
                wonAmount: userWins.reduce((sum, w) => sum + (w.prizeAmount || 0), 0)
            };
        });

        res.json({
            success: true,
            total: history.length,
            history
        });
    } catch (error) {
        console.error('Error in /recent:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;