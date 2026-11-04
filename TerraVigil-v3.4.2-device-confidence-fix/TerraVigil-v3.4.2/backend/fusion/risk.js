const HIGH_YOLO = 0.90;
const MEDIUM_YOLO = 0.75;

const HIGH_METAL = 0.70;
const MEDIUM_METAL = 0.30;


function calculateRisk(
    yoloConfidence,
    metalSignal,
    status
) {

    // --------------------------------
    // CONFIRMED DETECTION
    // --------------------------------

    if (status === "CONFIRMED") {

        if (
            yoloConfidence >= HIGH_YOLO &&
            metalSignal >= HIGH_METAL
        ) {

            return "HIGH";
        }


        if (
            yoloConfidence >= MEDIUM_YOLO ||
            metalSignal >= MEDIUM_METAL
        ) {

            return "MEDIUM";
        }


        return "LOW";
    }


    // --------------------------------
    // UNCONFIRMED OBSERVATION
    // --------------------------------

    if (status === "UNCONFIRMED") {

        if (yoloConfidence >= HIGH_YOLO) {

            return "HIGH";
        }


        if (yoloConfidence >= MEDIUM_YOLO) {

            return "MEDIUM";
        }


        return "LOW";
    }


    // --------------------------------
    // NO DETECTION
    // --------------------------------

    return null;
}


module.exports = {
    calculateRisk
};