const {
    determineConfirmation
} = require("./fusion/confirmation");


// Test 1
// YOLO detects + metal detected

console.log("TEST 1:");

console.log(
    determineConfirmation(0.95, true)
);


// Test 2
// YOLO detects + metal NOT detected

console.log("TEST 2:");

console.log(
    determineConfirmation(0.92, false)
);


// Test 3
// YOLO confidence below threshold

console.log("TEST 3:");

console.log(
    determineConfirmation(0.50, true)
);