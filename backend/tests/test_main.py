import sys
import os
# Add the backend directory to python path so tests can run from backend/ or root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "app": "Mine Logistics API"}

def test_docs_page():
    response = client.get("/docs")
    assert response.status_code == 200
    assert "Swagger UI" in response.text
