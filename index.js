require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const uri = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db('EduManageDB');
    const classCollection = db.collection('classes');

    console.log('✅ Connected to MongoDB');

    // Root route to avoid "Cannot GET /" error
    app.get('/', (req, res) => {
      res.send('Welcome to EduManage Server!');
    });

    // Get all classes
    app.get('/classes', async (req, res) => {
      const classes = await classCollection.find().toArray();
      res.json(classes);
    });

    // Add a new class
    app.post('/classes', async (req, res) => {
      const newClass = req.body;
      newClass.status = 'pending'; // default status
      const result = await classCollection.insertOne(newClass);
      res.json(result);
    });

    app.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });
  } catch (err) {
    console.error('❌ Connection error:', err);
  }
}

run();
