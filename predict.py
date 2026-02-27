import sys
import json
import pandas as pd
import pickle

def main():
    try:
        # 1. Catch the JSON payload sent from the Express.js backend
        # sys.argv[1] contains the stringified JSON passed via child_process
        input_string = sys.argv[1]
        payload = json.loads(input_string)
        
        weather_array = payload.get('weather_data', [])
        user_capacity_kw = float(payload.get('capacity_kw', 5.0))

        if not weather_array:
            print(json.dumps({"success": False, "error": "No weather data received."}))
            return

        # 2. Convert the incoming JSON array into a Pandas DataFrame
        df = pd.DataFrame(weather_array)
        
        # 3. Select ONLY the exact columns the model was trained on
        # If Express sends extra data (like 'hour' or 'humidity'), Pandas safely ignores it here
        features = ['IRRADIATION', 'AMBIENT_TEMPERATURE', 'MODULE_TEMPERATURE']
        X = df[features]

        # 4. Load your Phase 1 MVP Brain
        with open('solar_xgboost_master_model.pkl', 'rb') as file:
            model = pickle.load(file)

        # 5. Run the batch prediction for all daylight hours at once
        raw_predictions = model.predict(X)

        # 6. Scale for the User's Roof Size
        # The Kaggle dataset comes from a massive commercial plant (roughly 2000 kW).
        # We must scale the model's raw output down to match the user's requested capacity.
        KAGGLE_PLANT_CAPACITY_KW = 2000.0
        
        scaled_predictions = []
        for pred in raw_predictions:
            # Ensure we don't return negative power, and scale it linearly
            scaled_val = max(0, float(pred) * (user_capacity_kw / KAGGLE_PLANT_CAPACITY_KW))
            # Round to 2 decimal places for clean UI display
            scaled_predictions.append(round(scaled_val, 2))

        # 7. Package the results and print them to standard output (stdout)
        # Express listens to the stdout of this script to get the data back
        response = {
            "success": True,
            "hourly_generation_kwh": scaled_predictions
        }
        print(json.dumps(response))

    except Exception as e:
        # If anything crashes (e.g., missing file, wrong data type), tell Express cleanly
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
