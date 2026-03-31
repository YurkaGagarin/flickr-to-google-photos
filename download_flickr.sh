#!/bin/zsh

# Переходим в папку для загрузок
mkdir -p flickr_zips
cd flickr_zips

echo "🚀 Начинаю скачивание 77 архивов Flickr..."

urls=(
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_1.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_2.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_3.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_4.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_5.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_6.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_7.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_8.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_9.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_10.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_11.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_12.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_13.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_14.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_15.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_16.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_17.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_18.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_19.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_20.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_21.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_22.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_23.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_24.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_25.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_26.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_27.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_28.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_29.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_30.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_31.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_32.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_33.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_34.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_35.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_36.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_37.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_38.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_39.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_40.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_41.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_42.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_43.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_44.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_45.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_46.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_47.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_48.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_49.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_50.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_51.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_52.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_53.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_54.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_55.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_56.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_57.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_58.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_59.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_60.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_61.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_62.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_63.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_64.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_65.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_66.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_67.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_68.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_69.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_70.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_71.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_72.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_73.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_74.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_75.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_76.zip"
"https://downloads.flickr.com/d/data_52594039_268052b4061aa006ff817979861bab6c1d16e2c8e7990bfa927cdf8c8cd030dd_77.zip"
)

# Проходим по всем ссылкам
for url in "${urls[@]}"; do
  # Извлекаем номер архива (символ в конце перед .zip)
  filename=$(basename "$url")
  echo "📥 Скачиваю $filename..."
  
  # -L (следовать перенаправлениям), -C - (возобновить), -o (сохранить как)
  curl -L -C - -o "$filename" "$url"
  
  if [ $? -eq 0 ]; then
    echo "✅ Готово: $filename"
  else
    echo "❌ Ошибка при скачивании $filename"
  fi
done

echo "🎉 Все загрузки завершены!"
