require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


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
    // await client.connect();
    const db = client.db('EduManageDB');
    const userCollection = db.collection('users');
    const classCollection = db.collection('classes');
    const enrollCollection = db.collection('enroll');
    const assignmentsCollection = db.collection("assignments");
    const submissionsCollection = db.collection("submissions");
    const feedbacksCollection = db.collection('feedbacks');

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
      res.status(201).json({ message: 'Class added', insertedId: result.insertedId });

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

    // Get payment info and enrollment

    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { classId } = req.body;
        const email = req.user.email;

        if (!email) return res.status(400).json({ error: 'User email missing' });
        if (!classId || !ObjectId.isValid(classId)) return res.status(400).json({ error: 'Invalid class ID' });

        const classDoc = await classCollection.findOne({ _id: new ObjectId(classId) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        const amount = Math.round(classDoc.price * 100); // price in cents

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: 'usd',
          metadata: {
            email,
            classId,
          },
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error('Payment intent error:', error);
        res.status(500).json({ error: 'Failed to create payment intent' });
      }
    });




    app.post('/confirm-enroll', async (req, res) => {
      try {
        const { classId, paymentIntentId } = req.body;
        const email = req.user.email;

        if (!email || !classId || !paymentIntentId) {
          return res.status(400).json({ error: 'Missing data' });
        }

        const classDoc = await classCollection.findOne({ _id: new ObjectId(classId) });
        if (!classDoc) return res.status(404).json({ error: 'Class not found' });

        // Optional: verify paymentIntent from Stripe
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.status !== 'succeeded') {
          return res.status(400).json({ error: 'Payment not completed' });
        }

        // Prevent duplicate enrollments
        const existing = await enrollCollection.findOne({
          classId: new ObjectId(classId),
          email,
        });
        if (existing) return res.status(400).json({ error: 'Already enrolled in this class' });

        // Save enrollment
        const result = await enrollCollection.insertOne({
          classId: new ObjectId(classId),
          email,
          enrolledAt: new Date(),
          paymentIntentId,
        });

        res.status(201).json({ message: 'Enrolled after payment', enrollmentId: result.insertedId });
      } catch (err) {
        console.error('Enroll after payment error:', err);
        res.status(500).json({ error: 'Server error' });
      }
    });



    // POST /payment-success
    app.post('/payment-success', async (req, res) => {
      const { classId, email, paymentId, amount, classTitle } = req.body;

      if (!classId || !email || !paymentId) {
        return res.status(400).json({ success: false, message: "Missing data" });
      }

      try {
        await db.collection('payments').insertOne({
          email,
          classId,
          paymentId,
          amount,
          classTitle,
          date: new Date()
        });

        await db.collection('enroll').insertOne({
          email,
          classId,
          classTitle,
          enrolledAt: new Date()
        });

        res.send({ success: true });
      } catch (err) {
        console.error('DB Error:', err);
        res.status(500).json({ success: false, message: "DB Save failed" });
      }
    });





    // Delete class
    app.delete('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const result = await classCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result); // result.deletedCount > 0 means success
    });

    // Update class
    app.put('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await classCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result); // result.modifiedCount > 0 means success
    });




    // PATCH /classes/:id/status
    app.patch("/classes/:id/status", requireAdmin, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      const result = await classCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });






    app.post('/api/payments', async (req, res) => {
      try {
        const { classId, email, amount, paymentId } = req.body;
        if (!classId || !email || !amount || !paymentId) {
          return res.status(400).json({ error: 'Missing payment info' });
        }
        // Save payment info in a collection (create if needed)
        const db = client.db('EduManageDB');
        const paymentsCollection = db.collection('payments');

        await paymentsCollection.insertOne({
          classId: new ObjectId(classId),
          email,
          amount,
          paymentId,
          createdAt: new Date(),
        });

        res.status(201).json({ message: 'Payment info saved' });
      } catch (error) {
        console.error('Error saving payment info:', error);
        res.status(500).json({ error: 'Server error' });
      }
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
    // Add this collection for teacher requests
    const teacherRequestCollection = db.collection('teacherRequests');

    // ----------- User POST request to apply as teacher -----------
    app.post('/api/users/request-teacher', async (req, res) => {
      const email = req.user.email;
      if (!email) return res.status(400).json({ error: 'User not logged in' });

      const { name, experience, title, category } = req.body;

      if (!name || !experience || !title || !category) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.role === 'teacher') {
        return res.status(400).json({ error: 'You are already a teacher' });
      }

      // Check if existing teacher request (pending or rejected)
      let existingRequest = await teacherRequestCollection.findOne({ email });

      if (existingRequest && existingRequest.status === 'pending') {
        return res.status(400).json({ error: 'Teacher request already pending' });
      }

      const newRequest = {
        email,
        name,
        experience,  // expected to be 'beginner', 'mid-level', or 'experienced'
        title,
        category,
        status: 'pending',
        requestedAt: new Date(),
      };

      if (existingRequest) {
        // Update existing rejected request to pending again
        await teacherRequestCollection.updateOne(
          { email },
          { $set: { ...newRequest, status: 'pending', requestedAt: new Date() } }
        );
      } else {
        await teacherRequestCollection.insertOne(newRequest);
      }

      res.json({ message: 'Teacher request submitted for review' });
    });

    // ----------- User GET their teacher request status -----------
    app.get('/api/users/request-teacher/status', async (req, res) => {
      const email = req.user.email;
      if (!email) return res.status(400).json({ error: 'User not logged in' });

      const request = await teacherRequestCollection.findOne({ email });
      if (!request) return res.json({ status: null });

      res.json({ status: request.status });
    });

    // ----------- User resubmit rejected request -----------
    app.patch('/api/users/request-teacher/resubmit', async (req, res) => {
      const email = req.user.email;
      if (!email) return res.status(400).json({ error: 'User not logged in' });

      const request = await teacherRequestCollection.findOne({ email });
      if (!request || request.status !== 'rejected') {
        return res.status(400).json({ error: 'No rejected request to resubmit' });
      }

      await teacherRequestCollection.updateOne(
        { email },
        { $set: { status: 'pending', requestedAt: new Date() } }
      );

      res.json({ message: 'Teacher request resubmitted for review' });
    });

    // ----------- Admin: get all teacher requests -----------
    app.get('/api/users/teacher-requests', requireAdmin, async (req, res) => {
      const requests = await teacherRequestCollection.find({ status: { $in: ['pending', 'rejected'] } }).toArray();
      res.json(requests);
    });

    // ----------- Admin: approve teacher request -----------
    app.patch('/api/users/approve-teacher/:email', requireAdmin, async (req, res) => {
      const email = req.params.email;

      const request = await teacherRequestCollection.findOne({ email, status: 'pending' });
      if (!request) return res.status(404).json({ error: 'No pending request found for this user' });

      // Update user role to teacher
      await userCollection.updateOne({ email }, { $set: { role: 'teacher' } });

      // Update request status to approved
      await teacherRequestCollection.updateOne({ email }, { $set: { status: 'approved', approvedAt: new Date() } });

      res.json({ message: 'Teacher request approved and user role updated' });
    });

    // ----------- Admin: deny teacher request -----------
    app.patch('/api/users/deny-teacher/:email', requireAdmin, async (req, res) => {
      const email = req.params.email;

      const request = await teacherRequestCollection.findOne({ email, status: 'pending' });
      if (!request) return res.status(404).json({ error: 'No pending request found for this user' });

      // Update request status to rejected
      await teacherRequestCollection.updateOne({ email }, { $set: { status: 'rejected', rejectedAt: new Date() } });

      res.json({ message: 'Teacher request denied' });
    });






    // assignment
    app.post('/assignments', async (req, res) => {
      try {
        const assignment = req.body;

        // Basic validation (add more if needed)
        if (
          !assignment.title ||
          !assignment.deadline ||
          !assignment.description ||
          !assignment.classId
        ) {
          return res.status(400).json({ error: "Missing required assignment fields" });
        }

        // Insert into MongoDB collection
        const result = await assignmentsCollection.insertOne(assignment);

        // Respond with the created assignment document
        res.status(201).json(result.ops[0]);
      } catch (error) {
        console.error("Error creating assignment:", error);
        res.status(500).json({ error: "Failed to create assignment" });
      }
    });



    // Get assignments for a class
    app.get('/assignments', async (req, res) => {
      const { classId } = req.query;
      if (!classId) return res.status(400).json({ error: "classId query param is required" });

      try {
        const assignments = await assignmentsCollection.find({ classId }).toArray();
        res.json(assignments);
      } catch (error) {
        console.error('Failed to fetch assignments:', error);
        res.status(500).json({ error: "Failed to fetch assignments" });
      }
    });

    // Get submissions for a class
    app.get('/submissions', async (req, res) => {
      const { classId } = req.query;
      if (!classId) return res.status(400).json({ error: "classId query param is required" });

      try {
        const submissions = await submissionsCollection.find({ classId }).toArray();
        res.json(submissions);
      } catch (error) {
        console.error('Failed to fetch submissions:', error);
        res.status(500).json({ error: "Failed to fetch submissions" });
      }
    });


    app.post('/submissions', async (req, res) => {
      const { assignmentId, classId, userEmail, submission } = req.body;
      if (!assignmentId || !classId || !userEmail || !submission) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      try {
        await submissionsCollection.insertOne({
          assignmentId,
          classId,
          userEmail,
          submission,
          submittedAt: new Date(),
        });

        res.status(201).json({ message: 'Submitted' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to submit assignment' });
      }
    });



    app.post('/feedbacks', async (req, res) => {
      const { classId, email, feedback, rating } = req.body;
      if (!classId || !email || !feedback || !rating) {
        return res.status(400).json({ error: 'Missing feedback fields' });
      }

      try {
        await feedbacksCollection.insertOne({
          classId,
          email,
          feedback,
          rating,
          createdAt: new Date(),
        });

        res.status(201).json({ message: 'Feedback saved' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save feedback' });
      }
    });



    app.get('/api/feedbacks', async (req, res) => {
      try {
        const feedbacks = await feedbacksCollection.aggregate([
          { $sort: { createdAt: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: "users",
              localField: "email",
              foreignField: "email",
              as: "user"
            }
          },
          { $unwind: "$user" },
          {
            $project: {
              _id: 1,
              classId: 1,
              feedback: 1,
              rating: 1,
              createdAt: 1,
              "user.name": 1,
              "user.photo": 1,
            }
          }
        ]).toArray();

        res.json(feedbacks);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch feedbacks" });
      }
    });



    app.get("/api/popular-classes", async (req, res) => {
      try {
        const result = await db.collection("enroll").aggregate([
          {
            $group: {
              _id: "$classId",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 6 },
          {
            $lookup: {
              from: "classes",
              localField: "_id",
              foreignField: "_id", // make sure classId is ObjectId
              as: "classData",
            },
          },
          {
            $unwind: "$classData",
          },
          {
            $project: {
              _id: "$classData._id",
              title: "$classData.title",
              image: "$classData.image",
              instructor: "$classData.instructor",
              studentsEnrolled: "$count",
            },
          },
        ]).toArray();

        res.send(result);
      } catch (error) {
        console.error("Popular classes fetch failed:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });











    // ===== Start Server =====
    app.listen(port, () => {
      console.log(`🚀 Server running at http://edumanage-server-2qt9tuc5b-haruns-projects-63d4b953.vercel.app`);
    });

    process.on('SIGINT', async () => {
      console.log('\n🔌 Shutting down...');
      // await client.close();
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
