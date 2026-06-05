FROM php:8.2-apache

RUN docker-php-ext-install pdo pdo_mysql \
 && a2enmod rewrite

COPY src/ /var/www/html/
COPY apache-rewrite.conf /etc/apache2/conf-enabled/apache-rewrite.conf

RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf \
 && chown -R www-data:www-data /var/www/html

EXPOSE 80
