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

    // -------- Mock Authentication & Role Middleware --------
    // In real app, replace with proper auth (JWT, sessions, etc.)

    // Mock user attached to req (for demonstration)
    function mockAuth(req, res, next) {
      // For demo, we assume a user object with role property is set.
      // In practice, extract from JWT or session.
      req.user = {
        email: req.headers['x-user-email'] || 'teacher@example.com',
        role: req.headers['x-user-role'] || 'teacher', // 'admin' or 'teacher' or 'student'
      };
      next();
    }

    // Middleware to allow only admin
    function requireAdmin(req, res, next) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admins only.' });
      }
      next();
    }

    app.use(mockAuth); // Apply mockAuth globally for demo

    // 🏠 Root route
    app.get('/', (req, res) => {
      res.send('Welcome to EduManage Server!');
    });

    // 📦 Get all classes OR filter by teacher email
    app.get('/classes', async (req, res) => {
      try {
        const email = req.query.email;
        const filter = email ? { email } : {};
        const classes = await classCollection.find(filter).toArray();
        res.json(classes);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch classes' });
      }
    });

    // 📦 Get a single class by ID
    app.get('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid class ID' });
        }
        const classData = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classData) {
          return res.status(404).json({ error: 'Class not found' });
        }
        res.json(classData);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch class' });
      }
    });

    // ➕ Add new class (status = pending)
    app.post('/classes', async (req, res) => {
      try {
        const newClass = req.body;

        // Basic validation
        if (!newClass.title || !newClass.price || !newClass.description || !newClass.image) {
          return res.status(400).json({ error: 'Missing required class fields' });
        }

        newClass.status = 'pending';
        newClass.email = req.user.email; // Assign teacher email from authenticated user

        const result = await classCollection.insertOne(newClass);
        res.status(201).json({ message: 'Class created', id: result.insertedId });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to add class' });
      }
    });

    // ❌ Delete class by ID (only teacher who owns or admin)
    app.delete('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid class ID' });
        }

        // Find class owner
        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) {
          return res.status(404).json({ error: 'Class not found' });
        }

        // Check permission: admin or owner
        if (req.user.role !== 'admin' && classDoc.email !== req.user.email) {
          return res.status(403).json({ error: 'Access denied to delete this class' });
        }

        const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Class not found or already deleted' });
        }
        res.json({ message: 'Class deleted' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete class' });
      }
    });

    // ✏️ Update class info by ID (only owner or admin)
    app.put('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid class ID' });
        }
        const updatedData = req.body;

        // Validate update fields
        const allowedFields = ['title', 'price', 'description', 'image'];
        const updateFields = {};
        for (const field of allowedFields) {
          if (updatedData[field]) updateFields[field] = updatedData[field];
        }
        if (Object.keys(updateFields).length === 0) {
          return res.status(400).json({ error: 'No valid fields to update' });
        }

        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) {
          return res.status(404).json({ error: 'Class not found' });
        }

        // Permission check: admin or owner
        if (req.user.role !== 'admin' && classDoc.email !== req.user.email) {
          return res.status(403).json({ error: 'Access denied to update this class' });
        }

        const result = await classCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );
        res.json({ message: 'Class updated', modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update class' });
      }
    });

    // ✅ PATCH - Update class status (only admin)
    app.patch('/classes/:id/status', requireAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid class ID' });
        }
        if (!['approved', 'rejected', 'pending'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status value' });
        }

        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) {
          return res.status(404).json({ error: 'Class not found' });
        }

        const result = await classCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.json({ message: 'Status updated', modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update status' });
      }
    });

    app.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server...');
      await client.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Connection error:', err);
  }
}

run();
