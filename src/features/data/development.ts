// 正式打包时隐藏开发入口；与具体清理方式无关。
export const ENABLE_TEST_DATA_MANAGEMENT = typeof window === 'undefined' || window.yayaDesktop?.mode !== 'sqlite'
