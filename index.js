const jwt = require("jsonwebtoken");
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const client = new MongoClient(process.env.MONGO_DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// Middleware Connections
app.use(cors());
app.use(express.json());

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(403).send("Not authorization");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (error, decoded) {
    if (error) {
      return res.status(403).send({ message: "No Access" });
    }
    req.decoded = decoded;
    next();
  });
}

// Routes
app.get("/", (req, res) => {
  res.send("Doctors Portal is running");
});

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("doctorsPortal")
      .collection("appointmentOptions");
    const bookingsCollection = client
      .db("doctorsPortal")
      .collection("bookings");
    const usersCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");

    // Note: Make sure you run this middleware ware after verify jwt middleware
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const admin = await usersCollection.findOne(query);
      if (admin?.role !== "admin") {
        return res.status(403).send(`You dosen't have access to edit this`);
      }
      next();
    };
    // Get req
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();

      // Code carefully
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    // Aggrigrate API update v2
    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await appointmentOptionCollection
        .aggregate([
          {
            $lookup: {
              from: "bookings",
              localField: "name",
              foreignField: "treatment",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentDate", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              slots: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();
      res.send(options);
    });

    // get specialty
    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const specialty = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(specialty);
    });
    // Get bookings
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decoedEmail = req.decoded.email;
      if (email !== decoedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        treatment: booking.treatment,
        email: booking.email,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You have already booking on ${booking.appointmentDate} ${booking.treatment}`;
        return res.send({ acknowledged: false, message });
      }
      const bookingRes = await bookingsCollection.insertOne(booking);
      res.send(bookingRes);
    });

    // Get JWT token
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }
      res.status(401).send({ message: "Unauthorized" });
    });

    // Get All users
    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });
    // Save user information
    app.post("/users", async (req, res) => {
      const user = req.body;
      const users = await usersCollection.insertOne(user);
      res.send(users);
    });

    // Get users permission
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const adminUser = await usersCollection.findOne(query);
      res.send({ isAdmin: adminUser?.role === "admin" });
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: { role: "admin" },
      };
      const adminUser = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(adminUser);
    });

    app.delete("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const email = req.body.email;
      const filter = { _id: ObjectId(id) };
      const query = { email };
    });

    //Get dockers
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doc = req.body;
      const doctor = await doctorsCollection.insertOne(doc);
      res.send(doctor);
    });
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const deleteDoctor = await doctorsCollection.deleteOne(filter);
      res.send(deleteDoctor);
    });
  } finally {
  }
}

run().catch(console.log());

// Connection
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Doctors Portal is running in port: " + PORT);
});
