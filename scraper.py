import os
from curl_cffi import requests

url = "https://www.prydwen.gg/zenless/characters"

print("Initializing Cloudflare bypass ...")

response = requests.get(url, impersonate="chrome120")

if response.status_code == 200:
    with open("characters_page.txt", "w", encoding="utf-8") as f:
        f.write(response.text)
    print("Completed! Prydwen data saved to characters_page.txt")
else:
    print(f"Failed! Response code: {response.status_code}")
    exit(1)
