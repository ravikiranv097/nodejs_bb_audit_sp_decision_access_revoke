---

# 📘 **Bitbucket Access Revocation & Evidence Collection Tool**

This Node.js application automates the revocation of **Bitbucket Data Center project permissions** for users listed in a CSV file.
It also generates **HTML, PNG, and DOCX evidence files** similar to your reference audit application.

---

# 🚀 **Features**

### ✅ Reads input from:

```
input_files/access_check_results.csv
```

### For each record where `Access Status == HAS_ACCESS`:

1. **Revoke access** using Bitbucket DC REST API
   `DELETE /rest/api/1.0/projects/{projectKey}/permissions/users?name={user}`
2. **Verify access removal**
   `GET /rest/api/1.0/projects/{projectKey}/permissions/users?filter={user}`
3. **Generate evidence HTML file** containing:

   * User details
   * API URL
   * REST response JSON
4. **Capture screenshot PNG** via Puppeteer (cropped & trimmed automatically)
5. **Write results** into:

   * `access_check_results_after_revoke.csv`
   * `no_access_check_results_after_revoke.csv`
6. **Generate DOCX reports**:

   * `Bitbucket_Has_Access_Report.docx`
   * `Bitbucket_No_Access_Report.docx`

---

# 📂 **Folder Structure**

Your project should look like:

```
project-root/
├── bitbucket_revoke_from_csv.js
├── README.md
├── .env
├── input_files/
│   └── access_check_results.csv
└── output_files/
    ├── access_check_results_after_revoke.csv
    ├── no_access_check_results_after_revoke.csv
    ├── html/
    ├── png/
    │   ├── has_access/
    │   └── no_access/
    ├── doc/
    │   ├── Bitbucket_Has_Access_Report.docx
    │   └── Bitbucket_No_Access_Report.docx
    └── logs/
```

---

# ⚙️ **Setup Instructions**

### 1️⃣ Install dependencies

```bash
npm install axios csv-parse puppeteer officegen sharp dotenv
```

> **Note:** Puppeteer installs Chromium by default (~100MB).
> If you want to use system Chrome, update the launcher in the script.

---

### 2️⃣ Create `.env` file

Create a `.env` in the project root:

```
BB_URL=http://your-bitbucket-dc-url:7990
BB_USERNAME=admin
BB_KEYNAME=app_password_or_token
```

> 💡 **Important:**
> `BB_URL` **must include** `http://` or `https://`.

---

### 3️⃣ Place your input CSV

Your input file should be placed in:

```
input_files/access_check_results.csv
```

Required columns:

| Username | Account ID | Project Key | Access Permission | Access Status |
| -------- | ---------- | ----------- | ----------------- | ------------- |

Only rows with `HAS_ACCESS` will be processed.

---

# ▶️ **Run the Script**

Execute:

```bash
node bitbucket_revoke_from_csv.js
```

---

# 📄 **Generated Output**

### ✔ Updated CSVs

* `access_check_results_after_revoke.csv`
* `no_access_check_results_after_revoke.csv`

### ✔ Evidence Files

* **HTML** snapshots of API responses
* **PNG** screenshots (cropped + whitespace trimmed)

### ✔ DOCX Reports

Generated from screenshots:

* `Bitbucket_Has_Access_Report.docx`
* `Bitbucket_No_Access_Report.docx`

---

# 🔍 **Bitbucket REST APIs Used**

### Revoke access:

```
DELETE /rest/api/1.0/projects/{projectKey}/permissions/users?name={username}
```

### Verify access:

```
GET /rest/api/1.0/projects/{projectKey}/permissions/users?filter={username}
```

---

# 🛡️ **Error Handling / Logs**

All failures (API errors, screenshot errors, DOCX errors) are logged under:

```
output_files/logs/
```

---

