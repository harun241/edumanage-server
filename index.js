require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const uri = process.env.MONGO_URI;

app.use(cors({
  origin: '*', // Change this to your frontend origin in production
  allowedHeaders: ['Content-Type', 'x-user-email', 'x-user-role'],
}));
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
    const enrollCollection = db.collection('enroll'); // Enrollment collection

    console.log('✅ Connected to MongoDB');

    // Middleware: Mock Auth from headers
    function mockAuth(req, res, next) {
      req.user = {
        email: req.headers['x-user-email'] || null,
        role: req.headers['x-user-role'] || null,
      };
      // Debug logs - remove in production
   
      next();
    }

    // Middleware: Admin only access
    function requireAdmin(req, res, next) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admins only' });
      }
      next();
    }

    app.use(mockAuth);

    // Root
    app.get('/', (req, res) => {
      res.send('EduManage Server is Running 🚀');
    });

    // ==== User Routes ====

    // POST: Create User (default role: student)
    app.post('/api/users', async (req, res) => {
      try {
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
      } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Server error creating user' });
      }
    });

    // GET: Get Role by Email
    app.get('/api/users/role', async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({ role: user.role });
      } catch (error) {
        console.error('Get role error:', error);
        res.status(500).json({ error: 'Server error fetching role' });
      }
    });

    // ==== Class Routes ====

    // Get all classes or filter by teacher email
    app.get('/classes', async (req, res) => {
      try {
        const filter = req.query.email ? { email: req.query.email } : {};
        const classes = await classCollection.find(filter).toArray();
        res.json(classes);
      } catch (error) {
        console.error('Fetch classes error:', error);
        res.status(500).json({ error: 'Server error fetching classes' });
      }
    });

    // Get a class by ID
    app.get('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        res.json(classDoc);
      } catch (error) {
        console.error('Fetch class by ID error:', error);
        res.status(500).json({ error: 'Server error fetching class' });
      }
    });

    // Add new class (teacher adds class, default status pending)
    app.post('/classes', async (req, res) => {
      try {
        const newClass = req.body;
        if (!newClass.title || !newClass.price || !newClass.description || !newClass.image) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        newClass.status = 'pending';
        newClass.email = req.user.email;

        const result = await classCollection.insertOne(newClass);
        res.status(201).json({ message: 'Class added', id: result.insertedId });
      } catch (error) {
        console.error('Add class error:', error);
        res.status(500).json({ error: 'Server error adding class' });
      }
    });

    // Update class (admin or owner)
    app.put('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const update = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        if (req.user.role !== 'admin' && req.user.email !== classDoc.email) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        const allowedFields = ['title', 'price', 'description', 'image'];
        const updateFields = {};
        for (const key of allowedFields) {
          if (update[key]) updateFields[key] = update[key];
        }

        const result = await classCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );
        res.json({ message: 'Class updated', modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error('Update class error:', error);
        res.status(500).json({ error: 'Server error updating class' });
      }
    });

    // Patch class status (admin only)
    app.patch('/classes/:id/status', requireAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });
        if (!['pending', 'approved', 'rejected'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status value' });
        }

        const result = await classCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.json({ message: 'Status updated', modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Server error updating status' });
      }
    });

    // Delete class (admin or owner)
    app.delete('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

        const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        if (req.user.role !== 'admin' && req.user.email !== classDoc.email) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ message: 'Class deleted', deletedCount: result.deletedCount });
      } catch (error) {
        console.error('Delete class error:', error);
        res.status(500).json({ error: 'Server error deleting class' });
      }
    });

    // ==== Enrollment Routes ====

    // POST: Enroll in a class
    app.post('/enroll/:classId', async (req, res) => {
      try {
        const classId = req.params.classId;
        const email = req.user.email;

        if (!email) return res.status(400).json({ error: 'User email missing' });
        if (!ObjectId.isValid(classId)) return res.status(400).json({ error: 'Invalid class ID' });

        // Confirm class exists
        const classDoc = await classCollection.findOne({ _id: new ObjectId(classId) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        // Prevent duplicate enrollment
        const existingEnrollment = await enrollCollection.findOne({ classId: new ObjectId(classId), email });
        if (existingEnrollment) return res.status(400).json({ error: 'Already enrolled in this class' });

        // Insert enrollment record
        const enrollment = {
          classId: new ObjectId(classId),
          email,
          enrolledAt: new Date(),
        };

        const result = await enrollCollection.insertOne(enrollment);
        res.status(201).json({ message: 'Enrolled successfully', enrollmentId: result.insertedId });
      } catch (error) {
        console.error('Enroll error:', error);
        res.status(500).json({ error: 'Server error during enrollment' });
      }
    });

    // DELETE: Cancel enrollment
    app.delete('/enroll/:classId', async (req, res) => {
      try {
        const classId = req.params.classId;
        const email = req.user.email;

        if (!email) return res.status(400).json({ error: 'User email missing' });
        if (!ObjectId.isValid(classId)) return res.status(400).json({ error: 'Invalid class ID' });

        // Remove enrollment
        const result = await enrollCollection.deleteOne({ classId: new ObjectId(classId), email });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Enrollment not found or already cancelled' });
        }

        res.json({ message: 'Enrollment cancelled successfully' });
      } catch (error) {
        console.error('Cancel enrollment error:', error);
        res.status(500).json({ error: 'Server error during cancellation' });
      }
    });

    app.get('/api/stats', async (req, res) => {
  try {
    const totalUsers = await userCollection.estimatedDocumentCount();
    const totalClasses = await classCollection.estimatedDocumentCount();
    const totalEnrollments = await enrollCollection.estimatedDocumentCount();

    res.json({
      totalUsers,
      totalClasses,
      totalEnrollments,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

    // GET: List enrollments for current user
    app.get('/enrollments', async (req, res) => {
      try {
        const email = req.user.email;
        if (!email) return res.status(400).json({ error: 'User email missing' });

        const enrollments = await enrollCollection.find({ email }).toArray();
        res.json(enrollments);
      } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ error: 'Server error fetching enrollments' });
      }
    });



    // ==== End Enrollment Routes ====

    // Start server
    app.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nClosing MongoDB...');
      await client.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ MongoDB Connection Failed:', err);
  }
}

run();
