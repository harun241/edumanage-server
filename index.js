require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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

    // Root route
    app.get('/', (req, res) => {
      res.send('Welcome to EduManage Server!');
    });

    // ✅ Get all classes or filter by email (for teacher dashboard)
    app.get('/classes', async (req, res) => {
      const email = req.query.email;
      const filter = email ? { email } : {};
      const classes = await classCollection.find(filter).toArray();
      res.json(classes);
    });

    // ✅ Get single class by ID (for see details)
    app.get('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const classData = await classCollection.findOne({ _id: new ObjectId(id) });
      res.json(classData);
    });

    // ✅ Add new class
    app.post('/classes', async (req, res) => {
      const newClass = req.body;
      newClass.status = 'pending';
      const result = await classCollection.insertOne(newClass);
      res.json(result);
    });

    // ✅ Delete class by ID
    app.delete('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    // ✅ Update class by ID
    app.put('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const update = {
        $set: {
          title: updatedData.title,
          price: updatedData.price,
          description: updatedData.description,
          image: updatedData.image,
        },
      };

      const result = await classCollection.updateOne(
        { _id: new ObjectId(id) },
        update
      );
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
