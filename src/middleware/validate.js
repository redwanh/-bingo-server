// validate.js - Input validation middleware
const validate = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        
        if (error) {
            console.warn('⚠️ Validation failed:', error.details[0].message);
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                message: error.details[0].message
            });
        }
        
        next();
    };
};

// Example schema for card registration
const registerCardSchema = {
    validate: (data) => {
        const errors = [];
        
        if (!data.roomId || typeof data.roomId !== 'string') {
            errors.push('roomId is required and must be a string');
        }
        
        if (!data.cardId || typeof data.cardId !== 'string') {
            errors.push('cardId is required and must be a string');
        }
        
        // Check MongoDB ObjectId format
        const objectIdRegex = /^[0-9a-fA-F]{24}$/;
        if (data.cardId && !objectIdRegex.test(data.cardId)) {
            errors.push('cardId must be a valid MongoDB ID');
        }
        
        return {
            error: errors.length > 0 ? {
                details: errors.map(msg => ({ message: msg }))
            } : null
        };
    }
};

module.exports = { validate, registerCardSchema };