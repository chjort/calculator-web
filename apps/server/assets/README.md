common-passwords.txt: entries of 12+ characters, lower-cased and de-duplicated, from SecLists
`Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` (MIT). Regenerate with:

    curl -sSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt \
      | awk 'length($0)>=12' | tr A-Z a-z | sort -u > common-passwords.txt
