/* scripts/deploy.js */
import OSS from "ali-oss";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import chalk from "chalk"; // 用于终端颜色输出，如果没安装可换成 console.log
import mime from "mime-types";
import axios from "axios";

// 1. 初始化环境配置
// 为了在本地测试时能读取 .env 文件（CI/CD 环境中通常直接读取系统变量）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// 2. 检查必要的配置是否存在
const REQUIRED_KEYS = ["ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET", "ALIYUN_BUCKET", "ALIYUN_REGION"];
const missingKeys = REQUIRED_KEYS.filter(key => !process.env[key]);

if (missingKeys.length > 0) {
  console.error(chalk.red(`❌ 缺少环境变量: ${missingKeys.join(", ")}`));
  console.log(chalk.yellow("提示: 请在项目根目录创建 .env.local 文件或在 CI/CD 变量中配置。"));
  process.exit(1);
}

// 3. 创建 OSS 客户端实例
const client = new OSS({
  region: process.env.ALIYUN_REGION, // 例如 oss-cn-hangzhou
  accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
  bucket: process.env.ALIYUN_BUCKET,
  secure: true // 使用 HTTPS
});

// 构建目录路径 (根据 vite.config.ts 的 outDir: "dist")
const distPath = path.resolve(__dirname, "../dist");

/**
 * 递归获取所有文件
 */
function getAllFiles(dir, filesList = []) {
  if (!fs.existsSync(dir)) return filesList;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getAllFiles(filePath, filesList);
    } else {
      filesList.push(filePath);
    }
  });
  return filesList;
}

/**
 * 企业微信群机器人通知
 * */
async function sendWeComNotification(success, fileCount) {
  // webhook 在企业微信群内生成，可以把它放在 .env.local 里，并把它添加到云效流水线
  const webhookUrl = process.env.WECOM_WEBHOOK;

  if (!webhookUrl) return;

  let deployEnv;
  let url;
  if (process.env.ALIYUN_BUCKET === "fe-deploy-hk") {
    deployEnv = "正式环境";
    url = "https://466430.xyz";
  } else if (process.env.ALIYUN_BUCKET === "geeker-staging") {
    deployEnv = "预发布环境";
    url = "http://pre.466430.xyz";
  } else if (process.env.ALIYUN_BUCKET === "geeker-test-1" || process.env.ALIYUN_BUCKET === "geeker-test-2") {
    deployEnv = "测试环境";
    if (process.env.ALIYUN_BUCKET === "geeker-test-1") {
      url = "http://test-1.466430.xyz";
    } else if (process.env.ALIYUN_BUCKET === "geeker-test-2") {
      url = "http://test-2.466430.xyz";
    } else {
      console.error("未找到对应的测试环境 Bucket");
    }
  } else {
    console.error("未找到对应的 Bucket");
  }
  const color = success ? "info" : "warning";
  const statusText = success ? "部署成功" : "部署失败";

  // Markdown 消息模版
  const content = {
    msgtype: "markdown",
    markdown: {
      content: `### 🚀 前端部署通知
> **项目**: Geeker-Admin
> **环境**: ${deployEnv}
> **状态**: <font color="${color}">${statusText}</font>
> **文件变动**: ${fileCount} 个文件
> **访问**: [点击访问](${url})
`
    }
  };

  try {
    await axios.post(webhookUrl, content);
    console.log(chalk.green("📢 企业微信通知发送成功"));
  } catch (e) {
    console.error(chalk.red("❌ 企业微信通知发送失败"), e.message);
  }
}

/**
 * 主执行函数
 */
async function run() {
  console.log(chalk.cyan(`🚀 开始部署到阿里云 OSS (${process.env.ALIYUN_BUCKET})...`));

  // 1. 检查构建目录
  if (!fs.existsSync(distPath)) {
    console.error(chalk.red("❌ dist 目录不存在，请先执行 npm run build:pro"));
    process.exit(1);
  }

  const files = getAllFiles(distPath);

  // 我们只遍历原始文件（如 index.js），然后去查找它有没有对应的 .gz 版本
  // 这样可以避免把 index.js.gz 这种文件本身上传上去
  const sourceFiles = files.filter(f => !f.endsWith(".gz"));

  let successCount = 0;
  let failCount = 0;

  console.log(chalk.blue(`📦 准备上传 ${files.length} 个文件...`));

  // 2. 并发上传
  // 为了简单起见使用 for...of 循环，文件多时建议使用 p-limit 控制并发
  for (const filePath of sourceFiles) {
    // 计算 OSS 上的对象路径 (去掉本地 dist 前缀，并将 Windows 反斜杠转为正斜杠)
    const objectName = path.relative(distPath, filePath).replace(/\\/g, "/");

    // 检查是否存在对应的 .gz 文件
    const gzFilePath = `${filePath}.gz`;
    let uploadFilePath = filePath; // 默认上传原文件
    let isGzip = false;

    if (fs.existsSync(gzFilePath)) {
      uploadFilePath = gzFilePath; // 偷梁换柱：实际上传的是压缩包
      isGzip = true;
    }

    const headers = {};

    // 2.1. 自动计算文件的 Content-Type，让浏览器渲染而不是下载文件
    // 比如 index.html -> text/html, style.css -> text/css
    const mimeType = mime.lookup(filePath);
    if (mimeType) {
      headers["Content-Type"] = mimeType;
    }

    // 设置 Content-Encoding
    // 告诉浏览器："虽然我叫 index.js，但我其实是个 gzip 包，请解压后再运行"
    if (isGzip) {
      headers["Content-Encoding"] = "gzip";
    }

    // 2.2. 设置缓存策略 (核心优化)
    // 根据 vite.config.ts，静态资源带 hash，位于 assets/ 目录
    // 策略：index.html 不缓存(确保更新)，其他带 hash 的资源永久缓存
    if (objectName.endsWith(".html")) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else {
      // 静态资源 (js, css, png 等) 设置 1 年缓存
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }

    try {
      await client.put(objectName, uploadFilePath, { headers });

      // 打印日志：如果是 Gzip 上传，加个标记
      const statusLog = isGzip ? chalk.yellow("✔ Uploaded (Gzip)") : chalk.green("✔ Uploaded");
      console.log(`${statusLog}: ${objectName} \t ${chalk.gray(mimeType || "unknown")}`);

      successCount++;
    } catch (e) {
      console.error(`${chalk.red("✘ Failed:")} ${objectName}`, e.message);
      failCount++;
    }
  }

  console.log("--------------------------------------------------");
  if (failCount > 0) {
    console.log(chalk.red(`😭 部署完成，但有 ${failCount} 个文件失败，请检查日志。`));
    await sendWeComNotification(false, 0);
    process.exit(1);
  } else {
    console.log(chalk.green(`🎉 部署成功！共上传 ${successCount} 个文件。`));
    await sendWeComNotification(true, successCount);
  }
}

run();
