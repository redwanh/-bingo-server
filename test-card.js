const mongoose = require('mongoose');
const Card = require('./src/models/Card');

(async () => {
  await mongoose.connect('mongodb://localhost:27017/bingo');
  
  const card = new Card({
    gameId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    cardNumber: 1,
    grid: {
      B: [{number:1},{number:2},{number:3},{number:4},{number:5}],
      I: [{number:16},{number:17},{number:18},{number:19},{number:20}],
      N: [{number:31},{number:32},{number:33},{number:34},{number:35}],
      G: [{number:46},{number:47},{number:48},{number:49},{number:50}],
      O: [{number:61},{number:62},{number:63},{number:64},{number:65}]
    },
    price: 10
  });
  
  await card.save();
  console.log('Created test card:');
  console.log('  cardId:', card.cardId);
  console.log('  displayId:', card.displayId);
  console.log('  cardNumber:', card.cardNumber);
  
  await Card.deleteOne({ _id: card._id });
  console.log('Test card deleted.');
  process.exit(0);
})();