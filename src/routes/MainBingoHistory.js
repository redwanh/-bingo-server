const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const MainBingoGame = require('../models/MainBingoGame');
const User = require('../models/User');
const mongoose = require('mongoose');

// ============================================
// GET /api/main-bingo-history/all
// Fetch ALL Main Bingo game history
// ============================================
router.get('/all', protect, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        const status = req.query.status || 'all';

        // Build filter
        let filter = {};
        if (status !== 'all') filter.status = status;

        const [games, total] = await Promise.all([
            MainBingoGame.find(filter)
                .sort({ endTime: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('configId', 'name')
                .populate('ruleId', 'name')
                .lean(),
            MainBingoGame.countDocuments(filter)
        ]);

        const formattedGames = games.map(game => ({
            _id: game._id,
            gameId: game.gameId,
            gameNumber: game.gameNumber,
            configName: game.configId?.name || 'N/A',
            ruleName: game.ruleId?.name || 'N/A',
            status: game.status,
            prizeAmount: game.prizeAmount || 0,
            totalCards: game.totalCards || 0,
            playerCount: game.players?.length || 0,
            winners: game.winners || [],
            winnerCount: game.winners?.length || 0,
            drawnNumbers: game.drawnNumbers?.length || 0,
            startTime: game.startTime,
            endTime: game.endTime,
            createdAt: game.createdAt
        }));

        // Calculate summary stats
        const summary = {
            totalGames: total,
            totalPrizePool: games.reduce((sum, g) => sum + (g.prizeAmount || 0), 0),
            totalWinners: games.reduce((sum, g) => sum + (g.winners?.length || 0), 0),
            totalCards: games.reduce((sum, g) => sum + (g.totalCards || 0), 0),
            statusCounts: {
                setup: games.filter(g => g.status === 'setup').length,
                countdown: games.filter(g => g.status === 'countdown').length,
                in_progress: games.filter(g => g.status === 'in_progress').length,
                bingo_called: games.filter(g => g.status === 'bingo_called').length,
                grace_period: games.filter(g => g.status === 'grace_period').length,
                completed: games.filter(g => g.status === 'completed').length
            }
        };

        res.json({
            success: true,
            gameType: 'Main Bingo',
            summary,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            },
            games: formattedGames
        });
    } catch (error) {
        console.error('Error fetching Main Bingo history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch Main Bingo history',
            error: error.message
        });
    }
});

// ============================================
// GET /api/main-bingo-history/user/:userId
// Fetch user's Main Bingo game history
// ============================================
router.get('/user/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log('🔍 Main Bingo - User ID:', userId);

        // Check if user exists
        const user = await User.findById(userId).select('fullName phone username');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const status = req.query.status || 'completed';

        // Find games where user participated
        const filter = {
            'players.userId': userId,
            status: status
        };

        const [games, total] = await Promise.all([
            MainBingoGame.find(filter)
                .sort({ endTime: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('configId', 'name')
                .populate('ruleId', 'name')
                .lean(),
            MainBingoGame.countDocuments(filter)
        ]);

        console.log('📊 Main Bingo games found:', games.length);

        // Build history with user's wins
        const history = games.map(game => {
            // Find user's wins in this game
            const userWins = (game.winners || []).filter(w => {
                const wid = w.userId?.toString() || w.userId?._id?.toString() || '';
                return wid === userId;
            });

            // Find user's cards in this game
            const playerData = game.players?.find(p => {
                const pid = p.userId?.toString() || '';
                return pid === userId;
            });

            return {
                gameId: game.gameId || 'N/A',
                gameNumber: game.gameNumber || 0,
                configName: game.configId?.name || 'N/A',
                ruleName: game.ruleId?.name || 'N/A',
                status: game.status || 'unknown',
                prizeAmount: game.prizeAmount || 0,
                totalCards: game.totalCards || 0,
                playerCount: game.players?.length || 0,
                userCards: playerData?.cards?.length || 0,
                startTime: game.startTime,
                endTime: game.endTime,
                createdAt: game.createdAt,
                isWinner: userWins.length > 0,
                wins: userWins.map(w => ({
                    winType: w.winType || 'BINGO',
                    prizeAmount: w.prizeAmount || 0,
                    cardId: w.cardId || 'N/A'
                })),
                wonAmount: userWins.reduce((sum, w) => sum + (w.prizeAmount || 0), 0)
            };
        });

        // Calculate stats
        const stats = {
            totalGames: total,
            gamesWon: history.filter(g => g.isWinner).length,
            totalWon: history.reduce((sum, g) => sum + (g.wonAmount || 0), 0),
            winRate: total > 0 ? (history.filter(g => g.isWinner).length / total) * 100 : 0,
            totalCardsPlayed: history.reduce((sum, g) => sum + (g.userCards || 0), 0)
        };

        res.json({
            success: true,
            gameType: 'Main Bingo',
            user: {
                _id: user._id,
                fullName: user.fullName || 'Unknown',
                phone: user.phone || 'N/A',
                username: user.username || 'N/A'
            },
            stats,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            },
            history
        });
    } catch (error) {
        console.error('❌ Error fetching user Main Bingo history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user Main Bingo history',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ============================================
// GET /api/main-bingo-history/stats/:userId
// Get user's Main Bingo statistics
// ============================================
router.get('/stats/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log('📊 Main Bingo Stats for user:', userId);

        const user = await User.findById(userId).select('fullName phone');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get all Main Bingo games for this user
        const games = await MainBingoGame.find({
            'players.userId': userId,
            status: 'completed'
        }).lean();

        let totalGames = games.length;
        let gamesWon = 0;
        let totalWon = 0;
        let totalCardsPlayed = 0;

        games.forEach(game => {
            // Count user's cards
            const playerData = game.players?.find(p => {
                const pid = p.userId?.toString() || '';
                return pid === userId;
            });
            if (playerData) {
                totalCardsPlayed += playerData.cards?.length || 0;
            }

            // Count user's wins
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
            gameType: 'Main Bingo',
            user: {
                _id: user._id,
                fullName: user.fullName,
                phone: user.phone
            },
            stats: {
                totalGames,
                gamesWon,
                totalWon,
                totalCardsPlayed,
                winRate: totalGames > 0 ? (gamesWon / totalGames) * 100 : 0
            }
        });
    } catch (error) {
        console.error('Error fetching Main Bingo stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch Main Bingo stats',
            error: error.message
        });
    }
});

// ============================================
// GET /api/main-bingo-history/recent/:userId
// Get user's recent Main Bingo games
// ============================================
router.get('/recent/:userId', protect, async (req, res) => {
    try {
        const userId = req.params.userId;
        const limit = parseInt(req.query.limit) || 10;
        console.log('📋 Recent Main Bingo games for user:', userId);

        const games = await MainBingoGame.find({
            'players.userId': userId
        })
        .sort({ endTime: -1, createdAt: -1 })
        .limit(limit)
        .populate('configId', 'name')
        .populate('ruleId', 'name')
        .lean();

        const history = games.map(game => {
            const userWins = (game.winners || []).filter(w => {
                const wid = w.userId?.toString() || w.userId?._id?.toString() || '';
                return wid === userId;
            });

            return {
                gameId: game.gameId || 'N/A',
                gameNumber: game.gameNumber || 0,
                configName: game.configId?.name || 'N/A',
                ruleName: game.ruleId?.name || 'N/A',
                status: game.status || 'unknown',
                prizeAmount: game.prizeAmount || 0,
                playerCount: game.players?.length || 0,
                endTime: game.endTime,
                createdAt: game.createdAt,
                isWinner: userWins.length > 0,
                wonAmount: userWins.reduce((sum, w) => sum + (w.prizeAmount || 0), 0)
            };
        });

        res.json({
            success: true,
            gameType: 'Main Bingo',
            total: history.length,
            history
        });
    } catch (error) {
        console.error('Error fetching recent Main Bingo history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent Main Bingo history',
            error: error.message
        });
    }
});

// ============================================
// GET /api/main-bingo-history/game/:gameId
// Get specific Main Bingo game details
// ============================================
router.get('/game/:gameId', protect, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        
        const game = await MainBingoGame.findOne({ gameId })
            .populate('configId', 'name')
            .populate('ruleId', 'name')
            .populate('players.userId', 'fullName phone username')
            .lean();
            
        if (!game) {
            return res.status(404).json({
                success: false,
                message: 'Game not found'
            });
        }

        res.json({
            success: true,
            gameType: 'Main Bingo',
            game
        });
    } catch (error) {
        console.error('Error fetching Main Bingo game details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch game details',
            error: error.message
        });
    }
});

// ============================================
// GET /api/main-bingo-history/leaderboard
// Get Main Bingo leaderboard
// ============================================
router.get('/leaderboard', protect, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sort || 'wins'; // wins, winnings, games

        // Aggregation pipeline
        const leaderboard = await MainBingoGame.aggregate([
            { $match: { status: 'completed' } },
            { $unwind: '$winners' },
            {
                $group: {
                    _id: '$winners.userId',
                    wins: { $sum: 1 },
                    totalWon: { $sum: '$winners.prizeAmount' },
                    games: { $addToSet: '$gameId' }
                }
            },
            {
                $project: {
                    userId: '$_id',
                    wins: 1,
                    totalWon: 1,
                    gamesPlayed: { $size: '$games' }
                }
            },
            { $sort: { [sortBy === 'winnings' ? 'totalWon' : 'wins']: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    userId: 1,
                    wins: 1,
                    totalWon: 1,
                    gamesPlayed: 1,
                    fullName: '$user.fullName',
                    phone: '$user.phone'
                }
            }
        ]);

        res.json({
            success: true,
            gameType: 'Main Bingo',
            sortBy,
            leaderboard
        });
    } catch (error) {
        console.error('Error fetching Main Bingo leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leaderboard',
            error: error.message
        });
    }
});

module.exports = router;