const express = require('express');
const router = express.Router();
const { getAll, getOne, create, update, remove, toggleActive } = require('../controllers/cmsController');
const { protect, authorize } = require('../middleware/auth');

router.get('/public', getAll);
router.use(protect);
router.use(authorize('admin', 'superadmin'));
router.get('/', getAll);
router.get('/:id', getOne);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);
router.patch('/:id/toggle', toggleActive);

module.exports = router;
