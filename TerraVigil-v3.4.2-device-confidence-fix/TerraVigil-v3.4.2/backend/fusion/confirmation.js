const YOLO_THRESHOLD = 0.70;

function determineConfirmation(yoloConfidence, metalDetected) {

    const yoloDetected =
        yoloConfidence >= YOLO_THRESHOLD;

    // YOLO did not detect a landmine
    if (!yoloDetected) {

        return {
            status: "NO_DETECTION",
            layer: null
        };
    }

    // YOLO + metal detector
    if (metalDetected === true) {

        return {
            status: "CONFIRMED",
            layer: "LAYER_1"
        };
    }

    // YOLO but no metal
    return {
        status: "UNCONFIRMED",
        layer: "LAYER_2"
    };
}


module.exports = {
    determineConfirmation
};