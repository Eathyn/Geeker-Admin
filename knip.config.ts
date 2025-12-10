import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Knip 从这些入口文件开始扫描依赖关系。
  entry: [
    "src/main.ts",
    "vite.config.ts",
    "scripts/deploy.js", // 部署脚本
    "src/views/**/*.vue", // 显式将所有页面视图视为入口，这样 Knip 就会扫描所有页面，从而发现它们引用的组件和依赖
    "build/**/*.ts", // build 目录下的构建配置
    "commitlint.config.cjs", // 提交规范配置
    "lint-staged.config.cjs", // lint-staged 配置
    "postcss.config.cjs", // postcss 配置
    ".eslintrc.cjs", // eslint 配置
    ".stylelintrc.cjs", // stylelint 配置
    ".prettierrc.cjs" // prettier 配置
  ],

  // 告诉 Knip 哪些文件属于你的项目源代码，需要被扫描
  project: ["src/**/*.{ts,tsx,vue}", "scripts/**/*.{js,ts}", "build/**/*.{js,ts}"],

  // 这些文件会被完全忽略，不参与检查
  ignore: [
    "src/assets/**", // 静态资源通常不包含代码引用
    "**/*.d.ts", // 类型声明文件通常会有很多不直接引用的类型导出
    "public/**",
    "dist/**"
  ],

  // 忽略的依赖 (Ignore Dependencies)
  // 这里列出的是 Knip 可能会误报为“未使用”，但实际上你需要的包。
  // 这种情况通常发生在：
  // - 仅在 npm scripts 中使用的 CLI 工具
  // - 隐式引用的包（如 CSS 预处理器）
  // - 只有配置文件引用，没有在代码 import 的包
  ignoreDependencies: [
    // --- 样式相关 ---
    "stylelint-config-recommended-scss",
    // --- 隐式依赖 ---
    // eslint 配置文件中引用的解析器，通常由插件隐式调用
    "vue-eslint-parser"
  ],

  // 忽略的二进制命令 (Ignore Binaries)
  // 忽略 package.json scripts 中调用的这些命令
  ignoreBinaries: [
    // 'docker',                 // 如果脚本里有 docker 命令
  ],

  ignoreIssues: {
    // 忽略 utils 下的所有导出报错 (包括值导出和类型导出)
    "src/utils/**": ["exports", "types"],
    // 忽略 http 枚举的导出和枚举成员未使用的报错
    "src/enums/httpEnum.ts": ["exports", "enumMembers"],
    // 忽略接口定义文件的导出和类型报错
    "src/api/interface/index.ts": ["exports", "types"],
    "src/components/ProTable/interface/index.ts": ["exports", "types"]
  }

  // 插件配置 (Plugins)
  // Knip 内置了很多插件（如 Vite, Vue, ESLint），通常它能自动检测。
  // 你也可以手动强制开启或配置它们。
  // compilers: {
  //   vue: (text) => {
  //     // 这是一个简单的 Vue 编译器处理，用于提取 script 内容
  //     // 通常 Knip 默认的 Vue 插件已经处理得很好，这里仅作示例保留
  //     return text;
  //   }
  // }
};

export default config;
