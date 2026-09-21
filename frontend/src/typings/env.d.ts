/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_GLOB_API_URL: string;
	readonly VITE_APP_API_BASE_URL: string;
	readonly VITE_GLOB_APP_PWA: string;
	/** 构建时由 add-frontend-version.js 写入的日期版本号 (YYYYMMDD) */
	readonly VITE_APP_VERSION: string;
}
