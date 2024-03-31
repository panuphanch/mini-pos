# mini-pos
Create mini-pos to print receipt into thermal printer using Python.

## Need to install python3.8

1. Download installer from [python-380](https://www.python.org/downloads/release/python-380/)
2. Default path is C:\Users\[user_name]\AppData\Local\Programs\Python\Python38

## Running application

1. Create virtual environment `C:\Users\[user_name]\AppData\Local\Programs\Python\Python38\python.exe -m venv venv`
2. Will create `venv` as new folder
3. Activate virtual environment `venv\Scripts\active`
4. pip install -r requirement.txt
5. python main.py

## Create executable

1. Activate virtual environment
2. Run `python -m eel main.py web --add-data "_internal/*;."`