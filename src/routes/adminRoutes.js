const express = require('express');
const router = express.Router();
const { getAllUsers, getUser, updateUser, deleteUser, getStats } = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('admin', 'superadmin'));

router.get('/users', getAllUsers);
router.get('/stats', getStats);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', authorize('superadmin'), deleteUser);

module.exports = router;
