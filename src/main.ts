import { createApp } from "vue";
import App from "./App.vue";
// reset style sheet
import "@/styles/reset.scss";
// CSS common style sheet
import "@/styles/common.scss";
// iconfont css
import "@/assets/iconfont/iconfont.scss";
// font css
import "@/assets/fonts/font.scss";
// element css
import "element-plus/dist/index.css";
// element dark css
import "element-plus/theme-chalk/dark/css-vars.css";
// custom element dark css
import "@/styles/element-dark.scss";
// custom element css
import "@/styles/element.scss";
// svg icons
import "virtual:svg-icons-register";
// element plus
import ElementPlus from "element-plus";
// element icons
import * as Icons from "@element-plus/icons-vue";
// custom directives
import directives from "@/directives/index";
// vue Router
import router from "@/routers";
// vue i18n
import I18n from "@/languages/index";
// pinia store
import pinia from "@/stores";
// errorHandler
import errorHandler from "@/utils/errorHandler";
// Sentry
import * as Sentry from "@sentry/vue";
import { shouldMonitor } from "@/config/monitor";

const app = createApp(App);

/**
 * 针对不同环境决定是否开启异常监控的原则
 *   - 本地开发环境、本地预览环境：不开启。因为本地开发环境可以通过浏览器得到异常的文件和行数，开启后反而监控平台出现干扰数据。
 *   - 测试环境、预发布：最好开启。因为可以复现测试团队的 bug 流程。
 *   - 正式环境：必须开启。
 * */
if (shouldMonitor()) {
  /*--------------- Sentry ---------------*/
  Sentry.init({
    app,
    dsn: "https://4f6ef386ae6ea8cf252d64eba32eb3fa@o4510787921313792.ingest.us.sentry.io/4510788274880512",
    /**
     * 定义：是否发送默认的个人身份信息。如果设为 `true`，Sentry 会自动收集用户的 IP 地址 以及某些 Headers 中的敏感数据。如果设为 `false`，Sentry 会尽量不收集这些数据，以符合 GDPR（欧盟隐私法）或 PIPL（中国个保法）。
     * 业界实践：内网或测试环境可以设为 `true` 方便调试。
     * */
    sendDefaultPii: true,
    /**
     * 定义：启用 Sentry 的扩展插件
     * browserTracingIntegration：性能监控。
     * replayIntegration：会话回放。
     * */
    integrations: [Sentry.browserTracingIntegration({ router }), Sentry.replayIntegration()],
    /**
     * 定义：性能监控 (Tracing) 的采样率。1.0：采集 100% 的用户访问数据。0.1：只采集 10% 的用户访问数据。
     * 业界实践：低流量可以全采，高流量设置 0.1~0.2
     * */
    tracesSampleRate: 1.0, // Capture 100% of the transactions
    /**
     * 定义：Sentry 会拦截你发出的 AJAX/Fetch 请求，并自动在 Header 里塞入一个 sentry-trace 字段。
     * 业界实践：
     *  如果后端也接了 Sentry，后端收到这个 ID 后，就能把“前端请求 -> 后端处理 -> 数据库查询”这一整条链路串起来。
     *  你必须告诉 Sentry 哪些域名是你的后端 API。如果配了 localhost 或 *，Sentry 可能会把追踪 ID 发给第三方接口（如高德地图、七牛云），导致跨域问题 (CORS) 或隐私泄露。
     *  这里的正则必须替换成你真实的后端 API 域名
     * */
    // tracePropagationTargets: [/^https:\/\/api\.yourcompany\.com/],
    /**
     * 定义：普通会话（无报错）的录屏采样率。即用户来访问了，哪怕没报错，也把他操作的过程录下来发给 Sentry。
     * 业界实践：录屏非常消耗用户流量和性能，且极度消耗 Sentry 配额。如果用户没报错，看他的录屏通常意义不大（除非为了分析用户体验/产品路径）。
     * */
    replaysSessionSampleRate: 0, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
    /**
     * 定义：发生错误时的录屏采样率。即平时不录，一旦监测到报错，把报错前 30 秒到报错后的视频发上去。
     * 业界实践：1.0
     * */
    replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.,
    /**
     * 定义：控制 Sentry SDK 是否在浏览器的控制台 (Console) 打印自身的调试日志。
     * 业界实践：
     *  开发环境设为 true。方便看 Sentry 有没有初始化成功，数据有没有发出去。
     *  生产环境设为 false。保持控制台干净，避免暴露 SDK 内部细节给用户。
     * */
    enableLogs: false
  });
}

app.config.errorHandler = errorHandler;

// register the element Icons component
Object.keys(Icons).forEach(key => {
  app.component(key, Icons[key as keyof typeof Icons]);
});

app.use(ElementPlus).use(directives).use(router).use(I18n).use(pinia).mount("#app");
