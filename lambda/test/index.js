const axios = require("axios");
const AWS = require("aws-sdk");
require("dotenv").config();

// 환경변수
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const GITHUB_API_URL = process.env.GITHUB_API_URL;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// DynamoDB
const PROBLEM_HISTORY_TABLE = "ProblemHistory";
const dynamo = new AWS.DynamoDB.DocumentClient();

const SOLVEDAC_URL = "https://solved.ac/api/v3/search/problem";
const BAEKJOON_URL = "https://www.acmicpc.net";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X)";
const LEVELS = ["UR", "B5", "B4", "B3", "B2", "B1", "S5", "S4", "S3", "S2", "S1", "G5", "G4", "G3", "G2", "G1"];
const MAX_NUM = 4;

const TAG_WEIGHTS = {
  dp: 3,
  graph_traversal: 2,
  greedy: 3,
  binary_search: 2,
  backtracking: 3,
  queue: 2,
  stack: 2,
  trees: 1,
  string: 2,
  sorting: 1,
  dijkstra: 1,
  two_pointer: 2,
  hash_set: 1,
  prefix_sum: 1,
  recursion: 1,
  deque: 1,
  priority_queue: 2,
  data_structures: 3,
  disjoint_set: 2,
  bitmask: 1,
  set: 2,
  shortest_path: 2,
  parametric_search: 2,
  floyd_warshall: 1,
  topological_sorting: 1,
};

const DIFFICULTY_LEVELS = {
  SL: "s4..s3",
  SH: "s2..s1",
  GL: "g5",
  GH: "g4..g2",
};

const EXCLUDE_USERS = "!%40jennyeunjin+!%403veryday+!%4020011211";
const QUERY_SUFFIX = "+s%231000..+%25ko";

// 날짜 유틸
const getTodayKST = () =>
  new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit" }).replace(/\.\s?/g, "");

const getTodayKST_ISO = () => {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffset);
  return kstDate.toISOString().split("T")[0];
};

// 배열 섞기
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// 랜덤 태그
const getWeightedRandomTags = (count, exclude = []) => {
  const filtered = Object.entries(TAG_WEIGHTS).filter(([tag]) => !exclude.includes(tag));
  const weightedPool = [];
  filtered.forEach(([tag, weight]) => {
    for (let i = 0; i < weight; i++) weightedPool.push(tag);
  });

  const selected = new Set();
  while (selected.size < count && weightedPool.length > 0) {
    const tag = weightedPool[Math.floor(Math.random() * weightedPool.length)];
    selected.add(tag);
  }
  return Array.from(selected);
};

// 쿼리 문자열 생성
const buildQuery = (tag, level) => `*${DIFFICULTY_LEVELS[level]}+${EXCLUDE_USERS}${QUERY_SUFFIX}+%23${tag}&page=1&sort=random&direction=asc`;

// solved.ac 문제 검색
const fetchProblemsFromSolvedAc = async (query, count = 1) => {
  try {
    const requestUrl = `${SOLVEDAC_URL}?query=${query}`;
    const response = await axios.get(requestUrl, { headers: { "User-Agent": USER_AGENT } });
    return (response.data.items || []).slice(0, count).map(({ problemId, titleKo, level, tags }) => ({
      id: problemId,
      title: titleKo,
      level: LEVELS[level] || "Unknown",
      type: tags?.flatMap((tag) => tag.displayNames.filter((d) => d.language === "ko").map((d) => d.name)) || [],
    }));
  } catch (error) {
    console.error(`🔴 Error fetching problems: ${query}`, error.message);
    return [];
  }
};

// 태그 기반 문제 가져오기
const fetchTaggedProblems = async () => {
  const bruteCount = 1; // bruteforcing 무조건 1개
  const randCount = MAX_NUM - bruteCount;

  const selectedTags = getWeightedRandomTags(randCount, ["bruteforcing"]);
  const tags = [...selectedTags, "bruteforcing"];
  console.log("🔵 태그:", tags);

  const levelKeys = shuffleArray(["SL", "SH", "GL", "GH"]);
  let problems = [];

  for (let i = 0; i < MAX_NUM; i++) {
    const tag = tags[i];
    const level = levelKeys[i];
    const isBrute = tag === "bruteforcing";

    let query = buildQuery(tag, level);
    let result = await fetchProblemsFromSolvedAc(query, 1);
    let retry = 0;

    while (result.length === 0 && retry < 10 && !isBrute) {
      const newTag = getWeightedRandomTags(1, tags)[0];
      query = buildQuery(newTag, level);
      result = await fetchProblemsFromSolvedAc(query, 1);
      retry++;
    }
    if (result.length > 0) problems.push(result[0]);
  }

  return shuffleArray(problems);
};

// GitHub 이슈 생성
const createIssue = async (problemData) => {
  const title = `${getTodayKST()} : 모의 코딩테스트`;
  let body = "";
  for (const problem of problemData) {
    const problemUrl = `${BAEKJOON_URL}/problem/${problem.id}`;
    body += `### [${problem.id}: ${problem.title}](${problemUrl})\n`;
  }

  try {
    const res = await axios.post(
      `${GITHUB_API_URL}/issues`,
      { title, body, labels: ["🏆 test"] },
      { headers: { Authorization: `token ${ACCESS_TOKEN}`, Accept: "application/vnd.github.v3+json", "User-Agent": "BaekjoonBot" } }
    );
    return res.data.html_url;
  } catch (err) {
    console.error("🔴 GitHub Issue 실패:", err.response?.data || err.message);
    return null;
  }
};

// DynamoDB 저장
const insertProblemHistory = async (problemData) => {
  const targetDate = getTodayKST_ISO();
  const problems = problemData.map((p) => String(p.id));
  const params = {
    TableName: PROBLEM_HISTORY_TABLE,
    Item: {
      date: targetDate,
      problems,
    },
  };

  try {
    await dynamo.put(params).promise();
    console.log(`✅ ${targetDate} 문제 목록 저장 완료:`, problems);
  } catch (err) {
    console.error("❌ 문제 저장 실패:", err);
    throw err;
  }
};

// 🔔 디스코드 메시지 전송
const sendDiscord = async (problems, issueUrl) => {
  let content = `## 🏆 ${getTodayKST_ISO()} 모의 코딩테스트\n\n`;
  problems.forEach((p) => {
    content += `🔹 [[BOJ ${p.id}] ${p.title}](${BAEKJOON_URL}/problem/${p.id})\n`;
  });
  content += `\n**GitHub Issue 생성** ${issueUrl ? "✅" : "❌"}`;

  try {
    await axios.post(DISCORD_WEBHOOK, { content });
    console.log("✅ Discord 전송 완료");
  } catch (e) {
    console.error("🔴 Discord 전송 실패:", e.message);
  }
};

// 노션 데이터베이스에 추가
const addToNotionDatabase = async (problemData) => {
  try {
    for (const problem of problemData) {
      await axios.post(
        NOTION_PAGE_URL,
        {
          parent: { database_id: NOTION_DATABASE_ID },
          properties: {
            "문제 번호": { title: [{ text: { content: `${problem.id}` } }] },
            날짜: { date: { start: getTodayKST_ISO() } },
            난이도: { select: { name: problem.level } },
            유형: {
              multi_select: problem.type.map((type) => ({ name: type })),
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
        }
      );
    }
    console.log("Notion database updated");
    return true;
  } catch (error) {
    console.error("Error adding to Notion database:", error.response ? error.response.data : error.message);
    return false;
  }
};

// 🧑Lambda Handler
const handler = async () => {
  const problems = await fetchTaggedProblems();
  console.log(problems);

  if (problems.length !== MAX_NUM) {
    console.error("❌ 문제 수 부족");
    return { statusCode: 500, body: "문제 수 부족" };
  }

  const issueUrl = await createIssue(problems);
  await addToNotionDatabase(problems);
  await insertProblemHistory(problems); // ✅ DynamoDB 저장 추가
  await sendDiscord(problems, issueUrl);

  return { statusCode: 200, body: JSON.stringify({ problems }) };
};

module.exports = { handler };
