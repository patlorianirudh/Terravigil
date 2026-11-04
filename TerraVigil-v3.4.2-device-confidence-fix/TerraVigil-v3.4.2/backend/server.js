const path = require("node:path");
require("dotenv").config({
    path: path.join(__dirname, ".env"),
    quiet: true
});
const express = require("express");
const { connectDB } = require("./database");
const {
    determineConfirmation
} = require("./fusion/confirmation");
const {
    calculateRisk
} = require("./fusion/risk");
const cors = require("cors");
const { createRagService } = require("./rag/service");
const { createRagRouter } = require("./rag/routes");
const { createRoutingRouter, routeJsonErrorHandler } = require("./routing/routes");
function createMissionApp({ getDB = connectDB, virtualSample = false, ragService: suppliedRagService } = {}) {
const app = express();
if (virtualSample) app.use(cors());
app.use(express.json());
app.use(routeJsonErrorHandler);
if (virtualSample) app.use(require("./sample/routes").createSampleRouter());

const PORT = 3000;

// GET all missions
app.get("/missions", async (req, res) => {
    try {
        const db = await getDB();

        const missions = db.collection("missions");

        const result = await missions.find().toArray();

        res.json(virtualSample ? [...result.filter(row => row.mission_id !== "SAMPLE-TV001"), require("./sample/fixture.json").mission] : result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get missions"
        });
    }
});
// CREATE a mission
app.post("/missions", async (req, res) => {
    try {
        const db = await getDB();

        const missions = db.collection("missions");

        const mission = {
            mission_id: req.body.mission_id,
            date: new Date(),
            location: req.body.location,
            status: req.body.status
        };

        const result = await missions.insertOne(mission);

        res.status(201).json({
            message: "Mission created successfully",
            insertedId: result.insertedId
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to create mission"
        });
    }
});
// GET one mission
app.get("/missions/:mission_id", async (req, res) => {
    try {
        const db = await getDB();

        const missions = db.collection("missions");

        const mission = await missions.findOne({
            mission_id: req.params.mission_id
        });

        if (!mission) {
            return res.status(404).json({
                message: "Mission not found"
            });
        }

        res.json(mission);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get mission"
        });
    }
});
// UPDATE a mission
app.put("/missions/:mission_id", async (req, res) => {
    try {
        const db = await getDB();

        const missions = db.collection("missions");

        const result = await missions.updateOne(
            {
                mission_id: req.params.mission_id
            },
            {
                $set: {
                    location: req.body.location,
                    status: req.body.status
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                message: "Mission not found"
            });
        }

        res.json({
            message: "Mission updated successfully"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to update mission"
        });
    }
});
// DELETE a mission
app.delete("/missions/:mission_id", async (req, res) => {
    try {
        const db = await getDB();

        const missions = db.collection("missions");

        const result = await missions.deleteOne({
            mission_id: req.params.mission_id
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                message: "Mission not found"
            });
        }

        res.json({
            message: "Mission deleted successfully"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to delete mission"
        });
    }
});
// CREATE a confirmed detection
app.post("/detections", async (req, res) => {
    try {
        const db = await getDB();

        const detections = db.collection("detections");

        const detection = {
            detection_id: req.body.detection_id,
            mission_id: req.body.mission_id,
            timestamp: new Date(),

            latitude: req.body.latitude,
            longitude: req.body.longitude,

            yolo_confidence: req.body.yolo_confidence,

            metal_detected: req.body.metal_detected,
            metal_signal: req.body.metal_signal,

            status: "CONFIRMED",
            risk_level: req.body.risk_level,

            image_path: req.body.image_path
        };

        const result = await detections.insertOne(detection);

        res.status(201).json({
            message: "Detection created successfully",
            insertedId: result.insertedId
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to create detection"
        });
    }
});
// GET all detections
app.get("/detections", async (req, res) => {
    try {
        const db = await getDB();

        const detections = db.collection("detections");

        const result = await detections.find().toArray();

        res.json(result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get detections"
        });
    }
});
// GET one detection
app.get("/detections/:detection_id", async (req, res) => {
    try {
        const db = await getDB();

        const detections = db.collection("detections");

        const detection = await detections.findOne({
            detection_id: req.params.detection_id
        });

        if (!detection) {
            return res.status(404).json({
                message: "Detection not found"
            });
        }

        res.json(detection);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get detection"
        });
    }
});
// UPDATE a detection
app.put("/detections/:detection_id", async (req, res) => {
    try {
        const db = await getDB();

        const detections = db.collection("detections");

        const result = await detections.updateOne(
            {
                detection_id: req.params.detection_id
            },
            {
                $set: {
                    risk_level: req.body.risk_level,
                    metal_signal: req.body.metal_signal
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                message: "Detection not found"
            });
        }

        res.json({
            message: "Detection updated successfully"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to update detection"
        });
    }
});
// CREATE an unconfirmed observation
app.post("/observations", async (req, res) => {
    try {
        const db = await getDB();

        const observations = db.collection("observations");

        const observation = {
            observation_id: req.body.observation_id,
            mission_id: req.body.mission_id,
            timestamp: new Date(),

            latitude: req.body.latitude,
            longitude: req.body.longitude,

            yolo_confidence: req.body.yolo_confidence,

            metal_detected: req.body.metal_detected,
            metal_signal: req.body.metal_signal,

            status: "UNCONFIRMED",
            risk_level: req.body.risk_level,

            image_path: req.body.image_path
        };

        const result = await observations.insertOne(observation);

        res.status(201).json({
            message: "Observation created successfully",
            insertedId: result.insertedId
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to create observation"
        });
    }
});
// GET one observation
app.get("/observations/:observation_id", async (req, res) => {
    try {
        const db = await getDB();

        const observations = db.collection("observations");

        const observation = await observations.findOne({
            observation_id: req.params.observation_id
        });

        if (!observation) {
            return res.status(404).json({
                message: "Observation not found"
            });
        }

        res.json(observation);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get observation"
        });
    }
});
// GET observations for a mission
app.get("/missions/:mission_id/observations", async (req, res) => {
    try {
        const db = await getDB();

        const observations = db.collection("observations");

        const result = await observations.find({
            mission_id: req.params.mission_id
        }).toArray();

        res.json(result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get mission observations"
        });
    }
});
// UPDATE observation risk
app.put("/observations/:observation_id", async (req, res) => {
    try {
        const db = await getDB();

        const observations = db.collection("observations");

        const result = await observations.updateOne(
            {
                observation_id: req.params.observation_id
            },
            {
                $set: {
                    risk_level: req.body.risk_level
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                message: "Observation not found"
            });
        }

        res.json({
            message: "Observation risk updated successfully"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to update observation"
        });
    }
});

// GET confirmed detections for a mission
app.get("/missions/:mission_id/detections", async (req, res) => {
    try {
        const db = await getDB();

        const detections = db.collection("detections");

        const result = await detections.find({
            mission_id: req.params.mission_id
        }).toArray();

        res.json(result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get mission detections"
        });
    }
});

// CREATE telemetry record
app.post("/telemetry", async (req, res) => {
    try {
        const db = await getDB();

        const telemetry = db.collection("telemetry");

        const record = {
            mission_id: req.body.mission_id,
            timestamp: new Date(),

            latitude: req.body.latitude,
            longitude: req.body.longitude,
            altitude: req.body.altitude
        };

        const result = await telemetry.insertOne(record);

        res.status(201).json({
            message: "Telemetry created successfully",
            insertedId: result.insertedId
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to create telemetry"
        });
    }
});// GET all telemetry
app.get("/telemetry", async (req, res) => {
    try {
        const db = await getDB();

        const telemetry = db.collection("telemetry");

        const result = await telemetry.find().toArray();

        res.json(result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get telemetry"
        });
    }
});
// GET telemetry for a mission
app.get("/missions/:mission_id/telemetry", async (req, res) => {
    try {
        const db = await getDB();

        const telemetry = db.collection("telemetry");

        const result = await telemetry.find({
            mission_id: req.params.mission_id
        }).toArray();

        res.json(result);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Failed to get mission telemetry"
        });
    }
});


app.post("/fusion/test", async (req, res) => {

    try {

        const {
            mission_id,
            latitude,
            longitude,
            yolo_confidence,
            metal_detected,
            metal_signal
        } = req.body;


        // Run confirmation logic

        const result = determineConfirmation(
            yolo_confidence,
            metal_detected
        );
        // run risk claculation
        const riskLevel = calculateRisk(
    yolo_confidence,
    metal_signal,
    result.status
);


        // If YOLO does not detect anything,
        // don't create a Layer 1 or Layer 2 record

        if (result.status === "NO_DETECTION") {

            return res.json({
                message: "No landmine detection",
                result
            });

        }


        // Connect to MongoDB

        const db = await getDB();


        // Choose collection based on layer

        const collectionName =
            result.layer === "LAYER_1"
                ? "detections"
                : "observations";


        const collection =
            db.collection(collectionName);


        // Create record

     const record = {

    mission_id,

    latitude,

    longitude,

    yolo_confidence,

    metal_detected,

    metal_signal,

    status: result.status,

    layer: result.layer,

    risk_level: riskLevel,

    created_at: new Date()

};


        // Insert into MongoDB

        const insertResult =
            await collection.insertOne(record);


        res.json({

            message:
                "Fusion result stored successfully",

            inserted_id:
                insertResult.insertedId,

            result,
            risk_level: riskLevel,
            record

        });

    }

    catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Fusion processing failed",

            error:
                error.message

        });

    }

});

// ==========================================
// RISK API
// ==========================================

app.get("/missions/:mission_id/risk", async (req, res) => {

    try {

        const { mission_id } = req.params;

        const db = await getDB();

        // Get confirmed detections
        const detections = await db
            .collection("detections")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // Get unconfirmed observations
        const observations = await db
            .collection("observations")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // Convert both collections into
        // one common risk format

        const riskData = [

            ...detections.map(detection => ({
                latitude: detection.latitude,
                longitude: detection.longitude,
                status: detection.status,
                layer: "LAYER_1",
                risk_level: detection.risk_level
            })),

            ...observations.map(observation => ({
                latitude: observation.latitude,
                longitude: observation.longitude,
                status: observation.status,
                layer: "LAYER_2",
                risk_level: observation.risk_level
            }))

        ];


        res.json(riskData);

    }

    catch (error) {

        console.error(
            "Risk API error:",
            error
        );

        res.status(500).json({

            message: "Failed to load risk data",

            error: error.message

        });

    }

});

// ==========================================
// MISSION HISTORY API
// ==========================================

app.get("/missions/:mission_id/history", async (req, res) => {

    try {

        const { mission_id } = req.params;

        const db = await getDB();


        // Get Layer 1 records

        const detections = await db
            .collection("detections")
            .find({
                mission_id: mission_id
            })
            .sort({
                created_at: -1
            })
            .toArray();


        // Get Layer 2 records

        const observations = await db
            .collection("observations")
            .find({
                mission_id: mission_id
            })
            .sort({
                created_at: -1
            })
            .toArray();


        // Convert both into common format

        const history = [

            ...detections.map(detection => ({

                id: detection._id,

                mission_id: detection.mission_id,

                latitude: detection.latitude,

                longitude: detection.longitude,

                yolo_confidence:
                    detection.yolo_confidence,

                metal_detected:
                    detection.metal_detected,

                metal_signal:
                    detection.metal_signal,

                status:
                    detection.status,

                layer:
                    "LAYER_1",

                risk_level:
                    detection.risk_level,

                created_at:
                    detection.created_at

            })),


            ...observations.map(observation => ({

                id: observation._id,

                mission_id: observation.mission_id,

                latitude: observation.latitude,

                longitude: observation.longitude,

                yolo_confidence:
                    observation.yolo_confidence,

                metal_detected:
                    observation.metal_detected,

                metal_signal:
                    observation.metal_signal,

                status:
                    observation.status,

                layer:
                    "LAYER_2",

                risk_level:
                    observation.risk_level,

                created_at:
                    observation.created_at

            }))

        ];


        // Sort combined history
        // newest first

        history.sort(
            (a, b) =>
                new Date(b.created_at) -
                new Date(a.created_at)
        );


        res.json({

            mission_id: mission_id,

            total_records:
                history.length,

            records:
                history

        });

    }

    catch (error) {

        console.error(
            "History API error:",
            error
        );


        res.status(500).json({

            message:
                "Failed to load mission history",

            error:
                error.message

        });

    }

});

// ==========================================
// MISSION STATISTICS API
// ==========================================

app.get("/missions/:mission_id/statistics", async (req, res) => {

    try {

        const { mission_id } = req.params;

        const db = await getDB();


        // Get Layer 1 records

        const detections = await db
            .collection("detections")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // Get Layer 2 records

        const observations = await db
            .collection("observations")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // Combine both collections

        const records = [
            ...detections,
            ...observations
        ];


        // ==========================================
        // BASIC COUNTS
        // ==========================================

        const totalRecords =
            records.length;


        const confirmedCount =
            records.filter(
                record =>
                    record.status === "CONFIRMED"
            ).length;


        const unconfirmedCount =
            records.filter(
                record =>
                    record.status === "UNCONFIRMED"
            ).length;


        // ==========================================
        // RISK COUNTS
        // ==========================================

        const lowRisk =
            records.filter(
                record =>
                    record.risk_level === "LOW"
            ).length;


        const mediumRisk =
            records.filter(
                record =>
                    record.risk_level === "MEDIUM"
            ).length;


        const highRisk =
            records.filter(
                record =>
                    record.risk_level === "HIGH"
            ).length;


        // ==========================================
        // RESPONSE
        // ==========================================

        res.json({

            mission_id: mission_id,

            total_records: totalRecords,

            layer_1: {
                confirmed: confirmedCount
            },

            layer_2: {
                unconfirmed: unconfirmedCount
            },

            risk: {

                low: lowRisk,

                medium: mediumRisk,

                high: highRisk

            }

        });

    }

    catch (error) {

        console.error(
            "Statistics API error:",
            error
        );


        res.status(500).json({

            message:
                "Failed to calculate mission statistics",

            error:
                error.message

        });

    }

});
// ==========================================
// FINAL MISSION SUMMARY API
// ==========================================

app.get("/missions/:mission_id/summary", async (req, res) => {

    try {

        const { mission_id } = req.params;

        const db = await getDB();


        // ==========================================
        // 1. GET MISSION
        // ==========================================

        const mission = await db
            .collection("missions")
            .findOne({
                mission_id: mission_id
            });


        // ==========================================
        // 2. GET DETECTIONS - LAYER 1
        // ==========================================

        const detections = await db
            .collection("detections")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // ==========================================
        // 3. GET OBSERVATIONS - LAYER 2
        // ==========================================

        const observations = await db
            .collection("observations")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // ==========================================
        // 4. GET TELEMETRY
        // ==========================================

        const telemetry = await db
            .collection("telemetry")
            .find({
                mission_id: mission_id
            })
            .toArray();


        // ==========================================
        // 5. COMBINE RECORDS
        // ==========================================

        const records = [

            ...detections,

            ...observations

        ];


        // ==========================================
        // 6. CALCULATE STATISTICS
        // ==========================================

        const totalRecords =
            records.length;


        const confirmed =
            records.filter(
                record =>
                    record.status === "CONFIRMED"
            ).length;


        const unconfirmed =
            records.filter(
                record =>
                    record.status === "UNCONFIRMED"
            ).length;


        const lowRisk =
            records.filter(
                record =>
                    record.risk_level === "LOW"
            ).length;


        const mediumRisk =
            records.filter(
                record =>
                    record.risk_level === "MEDIUM"
            ).length;


        const highRisk =
            records.filter(
                record =>
                    record.risk_level === "HIGH"
            ).length;


        // ==========================================
        // 7. GPS INFORMATION
        // ==========================================

        const gpsPoints =
            telemetry.length;


        let minLatitude = null;

        let maxLatitude = null;

        let minLongitude = null;

        let maxLongitude = null;


        if (telemetry.length > 0) {

            const latitudes =
                telemetry
                    .map(point =>
                        Number(point.latitude)
                    )
                    .filter(
                        value =>
                            !Number.isNaN(value)
                    );


            const longitudes =
                telemetry
                    .map(point =>
                        Number(point.longitude)
                    )
                    .filter(
                        value =>
                            !Number.isNaN(value)
                    );


            if (latitudes.length > 0) {

                minLatitude =
                    Math.min(...latitudes);

                maxLatitude =
                    Math.max(...latitudes);

            }


            if (longitudes.length > 0) {

                minLongitude =
                    Math.min(...longitudes);

                maxLongitude =
                    Math.max(...longitudes);

            }

        }


        // ==========================================
        // 8. FINAL RESPONSE
        // ==========================================

        res.json({

            mission: mission,

            statistics: {

                total_records:
                    totalRecords,

                confirmed:
                    confirmed,

                unconfirmed:
                    unconfirmed,

                risk: {

                    low:
                        lowRisk,

                    medium:
                        mediumRisk,

                    high:
                        highRisk

                }

            },


            gps: {

                total_points:
                    gpsPoints,

                bounding_box: {

                    min_latitude:
                        minLatitude,

                    max_latitude:
                        maxLatitude,

                    min_longitude:
                        minLongitude,

                    max_longitude:
                        maxLongitude

                }

            },


            layer_1: {

                count:
                    detections.length,

                records:
                    detections

            },


            layer_2: {

                count:
                    observations.length,

                records:
                    observations

            }

        });

    }


    catch (error) {

        console.error(
            "Mission summary error:",
            error
        );


        res.status(500).json({

            message:
                "Failed to generate mission summary",

            error:
                error.message

        });

    }

});

// Mission RAG is additive: all existing CRUD, fusion, risk, history, statistics,
// and summary routes above remain unchanged.
const ragService = suppliedRagService || createRagService({ getDB });
app.use(createRagRouter(ragService));
app.use(createRoutingRouter({ connectDB: getDB }));

return { app, ragService };
}

const { app, ragService } = createMissionApp();

// Preserve direct node server.js launch compatibility with the integrated app.
if (require.main === module) {
    process.nextTick(() => require('./integrated-server').startServer().catch(error => {
        console.error(error.message); process.exitCode = 1;
    }));
}

module.exports = { app, ragService, createMissionApp };
