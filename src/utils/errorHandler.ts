import { ElNotification } from "element-plus";
import * as Sentry from "@sentry/vue";
import { shouldMonitor } from "@/config/monitor";

/**
 * @description 全局代码错误捕捉
 * */
const errorHandler = (error: any) => {
  // 过滤 HTTP 请求错误
  if (error.status || error.status == 0) return false;
  let errorMap: { [key: string]: string } = {
    InternalError: "Javascript引擎内部错误",
    ReferenceError: "未找到对象",
    TypeError: "使用了错误的类型或对象",
    RangeError: "使用内置对象时，参数超范围",
    SyntaxError: "语法错误",
    EvalError: "错误的使用了Eval",
    URIError: "URI错误"
  };
  let errorName = errorMap[error.name] || "未知错误";
  ElNotification({
    title: errorName,
    message: error,
    type: "error",
    duration: 3000
  });
  if (shouldMonitor()) {
    // 因为 app.config.errorHandler 捕获了错误，所以需要 Sentry 手动捕获错误，否则 Sentry 服务器收不到错误
    Sentry.captureException(error);
  }
};

export default errorHandler;
