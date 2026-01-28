export const shouldMonitor = () => {
  const isProduction = !import.meta.env.DEV;
  const isNotLocal = !["localhost", "127.0.0.1"].includes(location.hostname);
  return isProduction && isNotLocal;
};
