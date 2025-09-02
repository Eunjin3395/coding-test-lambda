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
const ATTENDANCE_TABLE = "Attendance";
const PROBLEM_HISTORY_TABLE = "ProblemHistory";

// github ID : discord ID
const USER_MAP = {
  Eunjin3395: "eunjin3395",
  KII1ua: "j11gen",
  "3veryDay": "haru_95532",
  "jaewon-ju": "jujaeweon_41932",
};

const handler = async (event) => {
  const prAuthor = event.prAuthor;
  const problemId = event.problemId;

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
    // ✅ ProblemHistory에서 문제 번호 유효성 확인
    const problemHistoryResult = await dynamo
      .get({
        TableName: PROBLEM_HISTORY_TABLE,
        Key: { date: today },
      })
      .promise();

    const validProblems = problemHistoryResult.Item?.problems || [];

    if (!validProblems.includes(normalizedProblemId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: `문제 ${normalizedProblemId}는 ${today}에 유효하지 않은 문제입니다.` }),
      };
    }

    // ✅ Attendance에서 기존 PR 목록 가져오기
    const getResult = await dynamo.get({ TableName: ATTENDANCE_TABLE, Key: { date: today, username } }).promise();
    const existingPr = getResult.Item?.pr || [];

    if (existingPr.includes(normalizedProblemId)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: `이미 제출된 문제입니다: ${normalizedProblemId}` }),
      };
    }

    // ✅ Attendance의 pr 필드 업데이트
    const updatedPr = [...existingPr, normalizedProblemId];

    await dynamo
      .update({
        TableName: ATTENDANCE_TABLE,
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
