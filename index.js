require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;
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
    const userCollection = db.collection('users');
    const classCollection = db.collection('classes');

    console.log('✅ Connected to MongoDB');

    // -------- Middleware --------
    function mockAuth(req, res, next) {
      req.user = {
        email: req.headers['x-user-email'] || 'teacher@example.com',
        role: req.headers['x-user-role'] || 'teacher',
      };
      next();
    }

    function requireAdmin(req, res, next) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admins only' });
      }
      next();
    }

    app.use(mockAuth);

    // -------- Routes --------

    // Root
    app.get('/', (req, res) => {
      res.send('EduManage Server is Running 🚀');
    });

    // ✅ POST: Create User (Default Role: student)
    app.post('/api/users', async (req, res) => {
      const { name, email, photo } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const existing = await userCollection.findOne({ email });
      if (existing) return res.json({ message: 'User already exists' });

      const result = await userCollection.insertOne({
        name,
        email,
        photo,
        role: 'student',
      });

      res.status(201).json({ message: 'User created', id: result.insertedId });
    });

    // ✅ GET: Get Role by Email
    app.get('/api/users/role', async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).json({ error: 'Email required' });

      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ role: user.role });
    });

    // ✅ Get all classes or filter by teacher email
    app.get('/classes', async (req, res) => {
      const filter = req.query.email ? { email: req.query.email } : {};
      const result = await classCollection.find(filter).toArray();
      res.json(result);
    });

    // ✅ Get class by ID
    app.get('/classes/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const classData = await classCollection.findOne({ _id: new ObjectId(id) });
      if (!classData) return res.status(404).json({ error: 'Not found' });

      res.json(classData);
    });

    // ✅ POST: Add new class (Status: pending)
    app.post('/classes', async (req, res) => {
      const newClass = req.body;

      if (!newClass.title || !newClass.price || !newClass.description || !newClass.image) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      newClass.status = 'pending';
      newClass.email = req.user.email;

      const result = await classCollection.insertOne(newClass);
      res.status(201).json({ message: 'Class added', id: result.insertedId });
    });

    // ✅ DELETE class by ID (admin or owner)
    app.delete('/classes/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
      if (!classDoc) return res.status(404).json({ error: 'Not found' });

      if (req.user.role !== 'admin' && req.user.email !== classDoc.email) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: 'Class deleted', deleted: result.deletedCount });
    });

    // ✅ PUT: Update class (admin or owner)
    app.put('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const update = req.body;

      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
      if (!classDoc) return res.status(404).json({ error: 'Not found' });

      if (req.user.role !== 'admin' && req.user.email !== classDoc.email) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const allowedFields = ['title', 'price', 'description', 'image'];
      const updateFields = {};
      for (let key of allowedFields) {
        if (update[key]) updateFields[key] = update[key];
      }

      const result = await classCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );
      res.json({ message: 'Class updated', modified: result.modifiedCount });
    });

    // ✅ PATCH: Update class status (Admin only)
    app.patch('/classes/:id/status', requireAdmin, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const result = await classCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.json({ message: 'Status updated', modified: result.modifiedCount });
    });

    // ✅ Start Server
    app.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
    });

    // Graceful Shutdown
    process.on('SIGINT', async () => {
      console.log('\n Closing MongoDB...');
      await client.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ MongoDB Connection Failed:', err);
  }
}

run();
