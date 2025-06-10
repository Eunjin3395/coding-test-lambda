const { handler } = require("./index");

(async () => {
  try {
    const result = await handler();
    console.log("Lambda Execution Result:");
    console.log(result);
  } catch (error) {
    console.error("Lambda Execution Error:");
    console.error(error);
  }
})();
