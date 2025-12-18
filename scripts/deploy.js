/* scripts/deploy.js */
import OSS from "ali-oss";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import chalk from "chalk"; // 用于终端颜色输出，如果没安装可换成 console.log
import mime from "mime-types";
import axios from "axios";
import Core from "@alicloud/pop-core";

// 1. 初始化环境配置
// 为了在本地测试时能读取 .env 文件（CI/CD 环境中通常直接读取系统变量）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// 2. 检查必要的配置是否存在
const REQUIRED_KEYS = ["ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET", "ALIYUN_BUCKET", "ALIYUN_REGION", "DOMAIN"];
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
  const message = {
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
    await axios.post(webhookUrl, message, { proxy: false });
    console.log(chalk.green("📢 企业微信通知发送成功"));
  } catch (e) {
    console.error(chalk.red("❌ 企业微信通知发送失败"), e);
  }
}

// 获取 OSS 上的所有文件
async function getOSSFiles() {
  console.log(chalk.blue("正在获取 OSS 现有文件列表以进行增量对比..."));
  const existingFileNames = new Set();
  try {
    let continuationToken = null;
    do {
      // listV2 支持列举大量文件
      const result = await client.listV2({
        "max-keys": 1000,
        "continuation-token": continuationToken
      });
      if (result.objects) {
        result.objects.forEach(obj => existingFileNames.add(obj.name));
      }
      continuationToken = result.nextContinuationToken;
    } while (continuationToken);
  } catch (err) {
    console.warn(chalk.yellow("⚠️ 获取 OSS 文件列表失败，将执行全量上传。"), err.message);
  }
  return existingFileNames;
}

/**
 * 主执行函数
 */
async function run() {
  console.log(chalk.cyan(`🚀 开始部署到阿里云 OSS (${process.env.ALIYUN_BUCKET})...`));

  const files = getAllFiles(distPath);

  // 我们只遍历原始文件（如 index.js），然后去查找它有没有对应的 .gz 版本
  // 这样可以避免把 index.js.gz 这种文件本身上传上去
  const rawFiles = files.filter(f => !f.endsWith(".gz"));

  // html 文件最后上传，避免用户访问到了新的 html 但是其他资源却还没上传导致的白屏问题
  const htmlFiles = rawFiles.filter(f => f.endsWith(".html"));
  const assetFiles = rawFiles.filter(f => !f.endsWith(".html"));
  const sourceFiles = [...assetFiles, ...htmlFiles];

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0; // 跳过的同名资源文件数量
  const OSSFileNames = await getOSSFiles();

  // 为了简单起见使用 for...of 循环，文件多时建议使用 p-limit 控制并发
  for (const filePath of sourceFiles) {
    // 计算 OSS 上的对象路径 (去掉本地 dist 前缀，并将 Windows 反斜杠转为正斜杠)
    const objectName = path.relative(distPath, filePath).replace(/\\/g, "/");
    // 如果是 html 文件，则永远覆盖。因为 html 文件是入口且没有文件哈希，即使内容变了文件名也不会变
    const isHtml = objectName.endsWith(".html");
    // 如果是其他静态资源 (例如 js, css, png)，且 OSS 上已有同名文件，则不上传改文件
    if (!isHtml && OSSFileNames.has(objectName)) {
      skipCount++;
      continue;
    }
    // 检查是否存在对应的 .gz 文件
    const gzFilePath = `${filePath}.gz`;
    let uploadFilePath = filePath; // 默认上传原文件
    let isGzip = false;
    if (fs.existsSync(gzFilePath)) {
      uploadFilePath = gzFilePath; // 偷梁换柱：实际上传的是压缩包
      isGzip = true;
    }
    const headers = {};
    // 自动计算文件的 Content-Type，让浏览器渲染而不是下载文件
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
    // 设置缓存策略
    // index.html 不缓存(确保更新)，其他带 hash 的资源永久缓存
    if (objectName.endsWith(".html")) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else {
      // 1 年缓存
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
  console.log(chalk.magenta(`success: ${successCount}`));
  console.log(chalk.magenta(`fail: ${failCount}`));
  console.log(chalk.magenta(`skip: ${skipCount}`));
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

// 已将 CDN 配置为 index.html 的缓存时间设置为 0 并且开启了强制内容重新验证：
//  1. 浏览器请求 index.html。
//  2. CDN 节点收到请求，发现配置是“缓存 0 秒”。
//  3. CDN 节点每次都会去 OSS 问一下：“文件改了吗？”（通过 ETag 对比）。
//  4. 因为你刚部署了新版，OSS 说：“改了，这是新的。”
//  5. CDN 拿到新版返回给你。
// refreshCDN 的作用：
//  - 万一某天你（或者你的同事）为了节省回源流量费用，或者手滑，把 index.html 的缓存时间改成了 10 分钟或 1 小时。如果没有这个刷新脚本，用户在部署后的一小时内看到的都是旧页面。保留脚本可以作为一道保险，确保无论 CDN 后台怎么配，部署后一定强制更新。
//  - 虽然 TTL=0 理论上是实时的，但在极少数网络抖动或节点同步延迟的情况下，CDN 的某些边缘节点可能会有短暂的滞后。调用“刷新缓存”接口是阿里云提供的最高优先级的强制清除指令，能保证全网节点瞬间清除旧数据。
//  - 除了 index.html，万一你的项目中还有其他不带 Hash 值的静态文件（比如 public/config.json，或者固定的图片 logo.png），如果你替换了它们，文件名没变，CDN 可能会缓存很久。这时候 refreshCDN 就是必须的。
async function refreshCDN() {
  const client = new Core({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    endpoint: "https://cdn.aliyuncs.com",
    apiVersion: "2018-05-10"
  });
  try {
    const domain = process.env.DOMAIN;
    // const domain = "http://test1.466430.xyz";
    // 同时刷新 / 和 /index.html
    const pathsToRefresh = [
      `${domain}/`, // 对应用户访问的根路径
      `${domain}/index.html` // 对应实际文件路径
    ].join("\n"); // 阿里云 API 支持换行符分隔多个 URL
    await client.request("RefreshObjectCaches", {
      ObjectPath: pathsToRefresh,
      ObjectType: "File" // 根路径 / 在阿里云CDN刷新中通常也被视为 File 类型刷新
    });
    console.log("✅ CDN 刷新成功: 根目录 & index.html");
  } catch (e) {
    console.error("❌ CDN 刷新失败", e);
  }
}

await run();
await refreshCDN();
