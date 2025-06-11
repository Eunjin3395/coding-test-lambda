const AWS = require("aws-sdk");
const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(timezone);

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: "ap-northeast-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const TABLE_NAME = "Attendance";

const USER_MAP = {
  Eunjin3395: "eunjin3395",
  rimi3226: "rimi_lim",
  KII1ua: "j11gen",
  kslvy: "kslvy",
};

const handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const { prAuthor, problemId } = body;

  if (!prAuthor || !problemId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "prAuthor와 problemId는 필수입니다." }),
    };
  }

  const username = USER_MAP[prAuthor];
  if (!username) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: `알 수 없는 작성자: ${prAuthor}` }),
    };
  }

  const normalizedProblemId = String(problemId);
  const today = dayjs().tz("Asia/Seoul").format("YYYY-MM-DD");

  try {
    const getResult = await dynamo.get({ TableName: TABLE_NAME, Key: { date: today, username } }).promise();

    const existingPr = getResult.Item?.pr || [];

    if (existingPr.includes(normalizedProblemId)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: `이미 제출된 문제입니다: ${normalizedProblemId}` }),
      };
    }

    const updatedPr = [...existingPr, normalizedProblemId];

    await dynamo
      .update({
        TableName: TABLE_NAME,
        Key: { date: today, username },
        UpdateExpression: "SET pr = :updatedPr",
        ExpressionAttributeValues: { ":updatedPr": updatedPr },
      })
      .promise();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `문제 ${normalizedProblemId} 저장 완료`, updatedPr }),
    };
  } catch (err) {
    console.error("❌ DynamoDB 오류:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "서버 오류", error: err.message }),
    };
  }
};

module.exports = { handler };
