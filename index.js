require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const uri = process.env.MONGO_URI;

app.use(cors({
  origin: '*',
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
    const enrollCollection = db.collection('enroll');

    console.log('✅ Connected to MongoDB');

    // ===== Middleware =====

    // Mock authentication (from headers)
    app.use((req, res, next) => {
      req.user = {
        email: req.headers['x-user-email'] || null,
        role: req.headers['x-user-role'] || null,
      };
      next();
    });

    const requireAdmin = (req, res, next) => {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admins only' });
      }
      next();
    };
    // সব ইউজার দেখার API (admin-only হলে requireAdmin যোগ করুন)
app.get('/api/users', async (req, res) => {
  const users = await userCollection.find({}).toArray();
  res.json(users);
});


   

    // ===== User Routes =====

    // Create user - role always 'student'
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
        teacherRequest: false,
      });

      res.status(201).json({ message: 'User created', id: result.insertedId });
    });

    // Get user role
    app.get('/api/users/role', async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).json({ error: 'Email required' });

      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ role: user.role });
    });

    // Student sends request to become teacher
    app.post('/api/users/request-teacher', async (req, res) => {
      const email = req.user.email;
      if (!email) return res.status(400).json({ error: 'User not logged in' });

      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.teacherRequest) {
        return res.status(400).json({ error: 'Teacher request already sent' });
      }

      if (user.role === 'teacher') {
        return res.status(400).json({ error: 'You are already a teacher' });
      }

      await userCollection.updateOne({ email }, { $set: { teacherRequest: true } });
      res.json({ message: 'Teacher request sent' });
    });

    // Admin: get all teacher requests
    app.get('/api/users/teacher-requests', requireAdmin, async (req, res) => {
      const requests = await userCollection.find({ teacherRequest: true }).toArray();
      res.json(requests);
    });

    // Admin: approve teacher request
    app.patch('/api/users/approve-teacher/:email', requireAdmin, async (req, res) => {
      const email = req.params.email;

      const result = await userCollection.updateOne(
        { email, teacherRequest: true },
        { $set: { role: 'teacher', teacherRequest: false } }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: 'No pending request found for this user' });
      }

      res.json({ message: 'Teacher role approved' });
    });

    // Admin: deny teacher request
    app.patch('/api/users/deny-teacher/:email', requireAdmin, async (req, res) => {
      const email = req.params.email;

      const result = await userCollection.updateOne(
        { email, teacherRequest: true },
        { $set: { teacherRequest: false } }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: 'No pending request found for this user' });
      }

      res.json({ message: 'Teacher request denied' });
    });

    // ===== Class Routes =====

    app.get('/classes', async (req, res) => {
      const filter = req.query.email ? { email: req.query.email } : {};
      const classes = await classCollection.find(filter).toArray();
      res.json(classes);
    });

    app.get('/classes/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
      if (!classDoc) return res.status(404).json({ error: 'Class not found' });

      res.json(classDoc);
    });

    app.post('/classes', async (req, res) => {
      const newClass = req.body;
      if (!newClass.title || !newClass.price || !newClass.description || !newClass.image) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      newClass.status = 'pending';
      newClass.email = req.user.email;

      const result = await classCollection.insertOne(newClass);
      res.status(201).json({ message: 'Class added', id: result.insertedId });
    });

    app.put('/classes/:id', async (req, res) => {
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
    });

    app.patch('/classes/:id/status', requireAdmin, async (req, res) => {
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
    });

    app.delete('/classes/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const classDoc = await classCollection.findOne({ _id: new ObjectId(id) });
      if (!classDoc) return res.status(404).json({ error: 'Class not found' });

      if (req.user.role !== 'admin' && req.user.email !== classDoc.email) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: 'Class deleted', deletedCount: result.deletedCount });
    });

    // ===== Enrollment Routes =====

    app.post('/enroll/:classId', async (req, res) => {
      try {
        const classId = req.params.classId;
        const email = req.user.email;

        if (!email) return res.status(400).json({ error: 'User email missing' });
        if (!ObjectId.isValid(classId)) return res.status(400).json({ error: 'Invalid class ID' });

        const classDoc = await classCollection.findOne({ _id: new ObjectId(classId) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        const existing = await enrollCollection.findOne({
          classId: new ObjectId(classId),
          email,
        });
        if (existing) return res.status(400).json({ error: 'Already enrolled in this class' });

        const result = await enrollCollection.insertOne({
          classId: new ObjectId(classId),
          email,
          enrolledAt: new Date(),
        });

        res.status(201).json({ message: 'Enrolled successfully', enrollmentId: result.insertedId });
      } catch (error) {
        console.error('Enroll error:', error);
        res.status(500).json({ error: 'Server error during enrollment' });
      }
    });

    app.delete('/enroll/:classId', async (req, res) => {
      const classId = req.params.classId;
      const email = req.user.email;

      if (!email) return res.status(400).json({ error: 'User email missing' });
      if (!ObjectId.isValid(classId)) return res.status(400).json({ error: 'Invalid class ID' });

      const result = await enrollCollection.deleteOne({
        classId: new ObjectId(classId),
        email,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Enrollment not found or already cancelled' });
      }

      res.json({ message: 'Enrollment cancelled successfully' });
    });

    app.get('/enrollments', async (req, res) => {
      const email = req.user.email;
      if (!email) return res.status(400).json({ error: 'User email missing' });

      const enrollments = await enrollCollection.find({ email }).toArray();
      res.json(enrollments);
    });

    // ===== Stats Route =====
    app.get('/api/stats', async (req, res) => {
      try {
        const totalUsers = await userCollection.estimatedDocumentCount();
        const totalClasses = await classCollection.estimatedDocumentCount();
        const totalEnrollments = await enrollCollection.estimatedDocumentCount();

        res.json({ totalUsers, totalClasses, totalEnrollments });
      } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    // ===== Start Server =====
    app.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });

    process.on('SIGINT', async () => {
      console.log('\n🔌 Shutting down...');
      await client.close();
      process.exit(0);
    });
     // ===== Root =====
    app.get('/', (req, res) => {
      res.send('🚀 EduManage Server is Running!');
    });
  } catch (err) {
    console.error('❌ MongoDB Connection Failed:', err);
  }
}

run();
