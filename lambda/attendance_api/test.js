require("dotenv").config(); // .env 파일에서 환경 변수 불러오기
const { handler } = require("./index"); // Lambda 핸들러 import

// 테스트 입력 구성
const testEvent = {
  body: JSON.stringify({
    prAuthor: "Eunjin3395", // USER_MAP에 정의된 GitHub ID
    problemId: "12345", // 추가할 문제 번호
  }),
};

// 테스트 실행 함수
(async () => {
  try {
    const response = await handler(testEvent);
    console.log("📦 응답 결과:");
    console.log(JSON.parse(response.body));
  } catch (err) {
    console.error("❌ 테스트 실행 중 오류:", err);
  }
})();
