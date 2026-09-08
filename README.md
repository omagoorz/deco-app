# deco-app

裝修估價 App 的手機互動原型（開發中）。

開啟：https://omagoorz.github.io/deco-app/

## 這個 repo 是什麼

一個單檔 HTML 的原型，用來驗證「手機拍照 → 上傳 → 另一台裝置看得到」。
資料存在 Supabase（PostgreSQL + Storage）。

## 為什麼原始碼裡有 API key

`index.html` 裡的 Supabase key 是 **anon key**——它**設計上就是公開的**，
任何網頁前端都會帶著它。實際的存取控制在資料庫端（Row Level Security）：

- 沒有加入某個 project 的身分，讀不到那個 project 的任何資料
- 上傳的檔案路徑第一段就是 project 代碼，權限規則比對它

`service_role` / `secret` key **不在這個 repo 裡，也不會放進來**。

## 現階段的安全等級

「知道 project 代碼的人就看得到」。**所以只放測試照片。**
正式使用會改成真正的登入。
