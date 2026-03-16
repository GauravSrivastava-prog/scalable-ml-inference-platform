from locust import HttpUser, task, between
import random
import requests

MODEL_ID = "0567a9f9-6b94-499e-a453-397ed889d6d4"

EMAIL = "gaurav@example.com"
PASSWORD = "pass1234"


workclasses = ["Private","Self-emp-not-inc","Local-gov","State-gov"]
educations = ["Bachelors","HS-grad","Masters","Some-college","Assoc-acdm"]
marital_statuses = ["Never-married","Married-civ-spouse","Divorced"]
occupations = ["Adm-clerical","Exec-managerial","Sales","Craft-repair","Tech-support"]
relationships = ["Not-in-family","Husband","Wife","Own-child"]
races = ["White","Black","Asian-Pac-Islander"]
genders = ["Male","Female"]
countries = ["United-States","Canada","Mexico"]


def generate_row():

    return {
        "age": random.randint(18,65),
        "workclass": random.choice(workclasses),
        "fnlwgt": random.randint(20000,300000),
        "education": random.choice(educations),
        "educational-num": random.randint(9,16),
        "marital-status": random.choice(marital_statuses),
        "occupation": random.choice(occupations),
        "relationship": random.choice(relationships),
        "race": random.choice(races),
        "gender": random.choice(genders),
        "capital-gain": random.choice([0,0,0,2174,5000]),
        "capital-loss": random.choice([0,0,0,0,1887]),
        "hours-per-week": random.randint(20,60),
        "native-country": random.choice(countries)
    }


class MLInferenceUser(HttpUser):

    wait_time = between(0.5,1.5)

    def on_start(self):
        """
        Login to auth service once per user
        """

        login_payload = {
            "email": EMAIL,
            "password": PASSWORD
        }

        response = requests.post(
            "http://localhost:8001/api/v1/auth/login",
            json=login_payload,
            headers={"Content-Type": "application/json"}
        )
        print("LOGIN STATUS:", response.status_code)
        print("LOGIN RESPONSE:", response.text)

        token = response.json()["access_token"]

        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }


    @task(2)
    def single_prediction(self):

        payload = {
            "model_id": MODEL_ID,
            "input_data": generate_row()
        }

        self.client.post(
            "/api/v1/predictions/predict",
            json=payload,
            headers=self.headers
        )


    @task(1)
    def batch_prediction(self):

        batch = [generate_row() for _ in range(5)]

        payload = {
            "model_id": MODEL_ID,
            "input_data": batch
        }

        self.client.post(
            "/api/v1/predictions/batch",
            json=payload,
            headers=self.headers
        )