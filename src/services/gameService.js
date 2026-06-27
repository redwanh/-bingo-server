import axios from 'axios';

const API = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api';

// ============================================
// GAME SERVICE - Fetch all game data
// ============================================

/**
 * Get current active game state
 * @param {string} token - User auth token
 * @param {string} roomId - Room ID (default: 'default')
 * @returns {Promise} Game state data
 */
export const getGameState = async (token, roomId = 'default') => {
  try {
    const response = await axios.get(`${API}/main-bingo/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching game state:', error);
    throw error;
  }
};

/**
 * Get game history for a room
 * @param {string} token - User auth token
 * @param {string} roomId - Room ID
 * @returns {Promise} Array of completed games
 */
export const getGameHistory = async (token, roomId = 'default') => {
  try {
    const response = await axios.get(`${API}/game/history/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching game history:', error);
    throw error;
  }
};

/**
 * Get user's game history
 * @param {string} token - User auth token
 * @param {string} userId - User ID
 * @returns {Promise} User's game history
 */
export const getUserGameHistory = async (token, userId) => {
  try {
    const response = await axios.get(`${API}/game/history/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user game history:', error);
    throw error;
  }
};

/**
 * Get current game table (all players and their cards)
 * @param {string} token - User auth token
 * @param {string} roomId - Room ID
 * @returns {Promise} Game table data
 */
export const getGameTable = async (token, roomId = 'default') => {
  try {
    const response = await axios.get(`${API}/game/table/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching game table:', error);
    throw error;
  }
};

/**
 * Get single player's game status
 * @param {string} token - User auth token
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise} Player game data
 */
export const getPlayerGameStatus = async (token, roomId, userId) => {
  try {
    const response = await axios.get(`${API}/game/table/${roomId}/player/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching player game status:', error);
    throw error;
  }
};

/**
 * Get scheduled games
 * @param {string} token - User auth token
 * @returns {Promise} Scheduled games
 */
export const getScheduledGames = async (token) => {
  try {
    const response = await axios.get(`${API}/scheduled-games/active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching scheduled games:', error);
    throw error;
  }
};

/**
 * Get user's cards
 * @param {string} token - User auth token
 * @param {string} roomId - Room ID
 * @returns {Promise} User's cards
 */
export const getUserCards = async (token, roomId = 'default') => {
  try {
    const response = await axios.get(`${API}/main-bingo/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { roomId }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user cards:', error);
    throw error;
  }
};

/**
 * Get all users (admin only)
 * @param {string} token - User auth token
 * @param {Object} params - Query parameters (page, limit, search, role, status)
 * @returns {Promise} Users data
 */
export const getUsers = async (token, params = {}) => {
  try {
    const response = await axios.get(`${API}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

/**
 * Get user by ID
 * @param {string} token - User auth token
 * @param {string} userId - User ID
 * @returns {Promise} User data
 */
export const getUserById = async (token, userId) => {
  try {
    const response = await axios.get(`${API}/admin/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
};

/**
 * Get user balance
 * @param {string} token - User auth token
 * @returns {Promise} User balance
 */
export const getUserBalance = async (token) => {
  try {
    const response = await axios.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data.user?.balance || 0;
  } catch (error) {
    console.error('Error fetching balance:', error);
    throw error;
  }
};

// ============================================
// HOOK - useGameData
// ============================================

import { useState, useEffect } from 'react';

export const useGameData = (token, roomId = 'default') => {
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);
  const [gameTable, setGameTable] = useState(null);
  const [scheduledGames, setScheduledGames] = useState([]);
  const [userCards, setUserCards] = useState([]);
  const [error, setError] = useState(null);

  const fetchAllData = async () => {
    if (!token) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch all data in parallel
      const [state, history, table, scheduled, cards] = await Promise.all([
        getGameState(token, roomId).catch(() => null),
        getGameHistory(token, roomId).catch(() => []),
        getGameTable(token, roomId).catch(() => null),
        getScheduledGames(token).catch(() => ({ games: [] })),
        getUserCards(token, roomId).catch(() => [])
      ]);
      
      setGameState(state);
      setGameHistory(history || []);
      setGameTable(table);
      setScheduledGames(scheduled?.games || []);
      setUserCards(cards || []);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching game data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [token, roomId]);

  return {
    loading,
    error,
    gameState,
    gameHistory,
    gameTable,
    scheduledGames,
    userCards,
    refresh: fetchAllData
  };
};

// ============================================
// HOOK - useUserHistory
// ============================================

export const useUserHistory = (token, userId) => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({
    totalGames: 0,
    wins: 0,
    totalWon: 0,
    gamesPlayed: 0
  });
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!token || !userId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await getUserGameHistory(token, userId);
      setHistory(data.history || []);
      setStats({
        totalGames: data.total || 0,
        wins: data.history?.filter(h => h.isWinner).length || 0,
        totalWon: data.history?.reduce((sum, h) => sum + (h.wonAmount || 0), 0) || 0,
        gamesPlayed: data.history?.length || 0
      });
    } catch (err) {
      setError(err.message);
      console.error('Error fetching user history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [token, userId]);

  return {
    loading,
    error,
    history,
    stats,
    refresh: fetchHistory
  };
};

export default {
  getGameState,
  getGameHistory,
  getUserGameHistory,
  getGameTable,
  getPlayerGameStatus,
  getScheduledGames,
  getUserCards,
  getUsers,
  getUserById,
  getUserBalance,
  useGameData,
  useUserHistory
};