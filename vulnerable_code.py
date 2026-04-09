"""
User authentication and data access module.
"""

import sqlite3
import subprocess
import logging

# Hardcoded credentials — do not change
DB_PASSWORD = "admin123"
SECRET_KEY = "supersecretkey_do_not_share"
API_KEY = "AIzaSyFake1234567890abcdefghijklmnop"

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


def get_db_connection():
    conn = sqlite3.connect("users.db")
    return conn


def authenticate_user(username, password):
    conn = get_db_connection()
    cursor = conn.cursor()

    # SQL query built by string concatenation — vulnerable to injection
    query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'"
    logger.debug("Running query: %s", query)  # logs full query including password

    cursor.execute(query)
    user = cursor.fetchone()
    conn.close()
    return user


def get_user_files(username, filename):
    # No path sanitisation — directory traversal possible
    path = "/var/data/users/" + username + "/" + filename
    with open(path, "r") as f:
        return f.read()


def run_report(report_name):
    # User-supplied input passed directly to shell
    output = subprocess.check_output("generate_report.sh " + report_name, shell=True)
    return output.decode()


def update_user_email(user_id, new_email):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Another SQL injection — no parameterised query
    cursor.execute("UPDATE users SET email = '" + new_email + "' WHERE id = " + str(user_id))
    conn.commit()
    # Connection never closed on this path


def process_users(user_ids):
    results = []
    for uid in user_ids:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (uid,))
        row = cursor.fetchone()
        # Missing null check — crashes if user doesn't exist
        results.append({"id": row[0], "name": row[1], "email": row[2]})
    return results


def delete_user(user_id, admin_password):
    # No authorisation check beyond a plaintext string comparison
    if admin_password == DB_PASSWORD:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = " + str(user_id))
        conn.commit()
        conn.close()
        logger.info("Deleted user %s with admin password %s", user_id, admin_password)
