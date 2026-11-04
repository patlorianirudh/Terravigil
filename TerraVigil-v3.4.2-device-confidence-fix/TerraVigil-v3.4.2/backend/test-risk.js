const {
    calculateRisk
} = require("./fusion/risk");


console.log("TEST 1");

console.log(
    calculateRisk(
        0.95,
        0.88,
        "CONFIRMED"
    )
);


console.log("TEST 2");

console.log(
    calculateRisk(
        0.92,
        0.12,
        "UNCONFIRMED"
    )
);


console.log("TEST 3");

console.log(
    calculateRisk(
        0.78,
        0.45,
        "CONFIRMED"
    )
);


console.log("TEST 4");

console.log(
    calculateRisk(
        0.55,
        0.10,
        "NO_DETECTION"
    )
);