# Mailchimp list comparison tool

  Released version:
  
  [![Build Status](https://travis-ci.com/merik-ematic/mc-list-comparison.svg?branch=master)](https://travis-ci.com/merik-ematic/mc-list-comparison)
  
  Alpha version:
  
  [![Build Status](https://travis-ci.com/merik-ematic/mc-list-comparison.svg?branch=future)](https://travis-ci.com/merik-ematic/mc-list-comparison)

## !! Read before use !!

  We should make sure every file comes with UTF-8 (even with BOM), if not, please convert to UTF-8 before start using this tool.

---

## Usage: (in the terminal)

### 0. After you pull this repo. if your're updating this program

 Please make sure you delete the `node_modules` folder and `npm install` again to align dependencies version before you using it.

### 1. Install Node.js and dependencies
    
  You can download and install node.js from [here](https://nodejs.org/en/download/) and install at least nodejs 10 or above, after installed switch to the tool folder and type:

  ```
  npm install
  ```

  [![asciicast](https://asciinema.org/a/pTsvZsX5I47ufv0ylhzGTXK9l.svg)](https://asciinema.org/a/pTsvZsX5I47ufv0ylhzGTXK9l)

### 2. Copy `.env.example` to `.env` and fillup those details

  ```
  HI_IQ_V2_API_URL=ENDPOINT URL here
  HI_IQ_V2_API_KEY=ENDPOINT KEY here

  CSE_TOOL_USERNAME=
  CSE_TOOL_PASSWORD=

  DV_DC=
  DV_TOKEN=
  ```

  [![asciicast](https://asciinema.org/a/pOxxtIEHeqvNqo1I5lMK3Um8V.svg)](https://asciinema.org/a/pOxxtIEHeqvNqo1I5lMK3Um8V)

### 3. Connect to VPN

  **REMEMBER** to connect to VPN before you start using this tool.
  
  This tool will fetch all the account information via server.

### 4. Run the script

  ```
  node mc-export-stream.js [csvFilePath]
  ```

  [![asciicast](https://asciinema.org/a/zV3JiG58Mh3E1Rlvn67qqPsF6.svg)](https://asciinema.org/a/zV3JiG58Mh3E1Rlvn67qqPsF6)

### 5. After finished, go ahead to the folder which your file is and you can see there's 8 additional files has been created maxmium.

  - FILNAME_new_results.csv
    - This file contains all the new emails that not in the list you compare with.
   - FILNAME_new_results_out.csv
    - Clean users by our CSE tool and verified the score on DV.
   - FILNAME_new_results_cleaned.csv
    - Cleaned users by our CSE tool and import as `cleaned ` status.
  - FILNAME_fail_results.csv
    - This file contains all the invalid emails that in the csv you compare.
  - FILNAME_cleaned_results.csv
    - This file contains all clean emails that in the list you compare with.
  - FILNAME_subscribed_results.csv
    - This file contains already subscribed emails that in the list you compare with.
  - FILNAME_unsubscribed_results.csv
    - This file contains already unsubscribed emails that in the list you compare with.
  
    For example: 
    ```
    1009-1018.csv (original csv)
    1009-1018_cleaned_results.csv
    1009-1018_new_results.csv
    1009-1018_fail_results.csv
    1009-1018_subscribed_results.csv
    1009-1018_blacklist_results.csv
    1009-1018_unsubscribed_results.csv
    1009-1018_new_results_out.csv
    1009-1018_new_results_cleaned.csv
    ```

### 6. Congratulations!

  #### For new subs only
  Now you have the files that contains all new subscribers called `FILNAME_new_results_out.csv` and `FILNAME_new_results_cleaned.csv` for new but cleaned by our CSE tool.
  
  just go through the hyatt process for the final step.


  #### For new/update subs
  You can update the existing users via `FILNAME_subscribed_results.csv` and go through the hyatt process for `FILNAME_new_results_out.csv` and import `FILNAME_new_results_cleaned.csv` as clened users.

  
