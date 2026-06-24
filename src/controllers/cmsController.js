const CMS = require('../models/CMS');
const AppError = require('../utils/AppError');

exports.getAll = async (req, res, next) => {
  try {
    const { type, language } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (language) filter.language = language;
    const items = await CMS.find(filter).sort({ order: 1, createdAt: -1 });
    const grouped = {};
    items.forEach(item => {
      const lang = item.language;
      if (!grouped[lang]) grouped[lang] = { terms: [], faq: [], contact: [] };
      grouped[lang][item.type].push(item);
    });
    res.json({ success: true, items, grouped });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await CMS.findById(req.params.id);
    if (!item) return next(new AppError('Not found', 404));
    res.json({ success: true, item });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const item = await CMS.create({ ...req.body, createdBy: req.user.id });
    res.status(201).json({ success: true, item });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const item = await CMS.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user.id }, { new: true, runValidators: true });
    if (!item) return next(new AppError('Not found', 404));
    res.json({ success: true, item });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await CMS.findByIdAndDelete(req.params.id);
    if (!item) return next(new AppError('Not found', 404));
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
};

exports.toggleActive = async (req, res, next) => {
  try {
    const item = await CMS.findById(req.params.id);
    if (!item) return next(new AppError('Not found', 404));
    item.isActive = !item.isActive;
    item.updatedBy = req.user.id;
    await item.save();
    res.json({ success: true, item });
  } catch (err) { next(err); }
};
