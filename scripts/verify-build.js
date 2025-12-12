import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");

console.log(chalk.cyan("开始构建产物验证..."));

// 验证 dist 目录是否存在
if (!fs.existsSync(distPath)) {
  console.error(chalk.red("❌ 错误: dist 目录不存在！构建可能失败了。"));
  process.exit(1);
} else {
  console.log(chalk.green(`✅ dist 目录存在`));
}

// 验证 index.html 是否存在
const indexPath = path.join(distPath, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error(chalk.red("❌ 错误: dist/index.html 缺失！"));
  process.exit(1);
} else {
  console.log(chalk.green(`✅ index.html 存在`));
}

// 验证 index.html 是否为空文件或残缺文件
const indexStats = fs.statSync(indexPath);
// 一个正常工作的 Vue/Vite 项目入口文件，算上最基础的标签和引用的 JS 路径，几乎不可能小于 100 字节
if (indexStats.size < 100) {
  console.error(chalk.red(`❌ 错误: dist/index.html 文件过小 (${indexStats.size} bytes)，可能是空文件。`));
  process.exit(1);
} else {
  console.log(chalk.green(`✅ index.html 体积大于 100 字节`));
}

// 验证 assets 目录是否存在
const assetsPath = path.join(distPath, "assets");
if (!fs.existsSync(assetsPath)) {
  console.error(chalk.red("❌ 错误: dist/assets 静态资源目录缺失！"));
  process.exit(1);
} else {
  console.log(chalk.green(`✅ assets 目录存在`));
}

// 递归查找文件
function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(file));
    } else {
      results.push(file);
    }
  });
  return results;
}

// 验证 assets 目录中是否存在 js 文件
const files = getFiles(assetsPath);
const jsFiles = files.filter(f => f.endsWith(".js"));
if (jsFiles.length === 0) {
  console.error(chalk.red("❌ 错误: 未找到 JS 文件，构建可能不完整。"));
  process.exit(1);
} else {
  console.log(chalk.green(`✅ assets 目录存在 JS 文件`));
}

// 验证是否存在压缩文件
const compressFiles = files.filter(f => f.endsWith(".gz") || f.endsWith(".br"));
if (compressFiles.length === 0) {
  console.warn(chalk.red("❌ 错误: 未找到压缩文件。"));
  console.warn(
    chalk.red("   请检查 vite.config.ts 中是否配置了 vite-plugin-compression，否则部署脚本将无法利用 Gzip/Brotli 优化。")
  );
  process.exit(1);
} else {
  console.log(chalk.green(`✅ assets 目录存在压缩文件`));
}

console.log(chalk.cyan("构建产物验证结束"));
