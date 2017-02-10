'use strict';

const base = new (require('base-io'));

VK = function(setting) {
	setting = setting || {};
	/* Основные настройки */
	this.settings = {
		/* Идентификатор пользователя */
		id: null,
		/* Email/логин от аккаунта */
		login: null,
		/* Номер телефона */
		phone: null,
		/* Пароль от аккаунта */
		pass: null,
		/* Токен */
		token: null,
		/* Приложение */
		app: null,
		/* Секретный ключ приложения */
		key: null,
		/* Список разрешений */
		scope: null,
		/* Лимит запросов в секунду */
		limit: 3,
		/* Перезапускать при ошибках */
		restartError: true,
		/* Количество доступных попыток перезапусков */
		restartCount: 3,
		/* Время сброса соединения на API */
		timeout: 6,
		/* Режим debug-а */
		debug: true,
		/* Прокси */
		proxy: null
	};

	this.setting(setting);

	/* Очередь методов */
	this._queue = [];

	/* Очередь методов */
	this._tasks = {
		/* Запущена ли выполнение очереди */
		launched: false,
		/* Идентификатор таймера */
		id: null
	};

	this._longpoll = {
		/* Запущен ли longpoll */
		launched: false,
		/* Сервер longpoll */
		server: null,
		/* Ключ авторизации */
		key: null,
		/* TimeStamp последних событий */
		ts: null
	};

	/* Обработчик капчи */
	this._captchaHandler = null;

	/**
	 * Встроенный логер сообщений
	 *
	 * @param string level
	 * @param object args
	 */
	const _log = (level,args) => {
		if (!this.settings.debug) {
			return;
		}

		args.unshift('[VK]['+level+']');

		console.log.apply(console,args);
	};

	this.logger = {
		log: function(){_log('LOG',arguments)},
		debug: function(){_log('DEBUG',arguments)},
		info: function(){_log('INFO',arguments)},
		warn: function(){_log('WARN',arguments)},
		error: function(){_log('ERROR',arguments)},
	};

	/* Установка методов VK API */
	this.api = {};
	this._apiMethods.forEach((method) => {
		var split = method.split('.');
		var group = split[0];
		var name = split[1];
		this.api[group] = this.api[group] || {};

		this.api[group][name] = (params) => {
			return this._api(method,params);
		};
	});

	this._secureMethods.forEach((method) => {
		var split = method.split('.');
		var group = split[0];
		var name = split[1];

		this.api[group] = this.api[group] || {};

		this.api[group][name] = (params) => {
			params = params || {};
			params.client_secret = this.settings.key;

			return this._api(method,params);
		};
	});

	/**
	 * Отправка сообщения
	 *
	 * @param object params Параметры
	 *
	 * @return promise
	 */
	this.api.messages.send = (params) => {
		params = params || {};
		params.random_id = Date.now();

		if ('attachment' in params && Array.isArray(params.attachment)) {
			params.attachment = params.attachment.join(',');
		}

		return this._api('messages.send',params);
	};

	/**
	 * Метод execute
	 *
	 * @param object params
	 *
	 * @return promise
	 */
	this.api.execute = (params) => {
		return this._api('execute',params);
	};

	/* Цепочки методов */
	this._properties('stream',this._streamHandlers);
	this._properties('upload',this._uploadHandlers);
};

/**
 * Устанавливает настройки модуля
 *
 * @param object setting
 *
 * @return this
 */
VK.prototype.setting = function(setting){
	Object.assign(this.settings,setting);

	if ('id' in setting) {
		this.settings.id = parseInt(this.settings.id);
	}

	return this;
};

/**
 * Устанавливает токен
 *
 * @param string token
 *
 * @return this
 */
VK.prototype.setToken = function(token) {
	this.settings.token = token;

	return this;
}

/**
 * Устанавливает обработчик капчи
 *
 * @param function handler Обработчик
 *
 * @return this
 */
VK.prototype.setCaptchaHandler = function(handler) {
	this._captchaHandler = handler;

	return this;
}

/**
 * Устанавливает логер сообщений
 *
 * @param object logger
 *
 * @return this
 */
VK.prototype.setLogger = function(logger) {
	this.logger = logger;

	return this;
}

/**
 * Метод execute сохраненный приложением
 *
 * @param string method Название метода
 * @param object params Список параметров
 *
 * @return this
 */
VK.prototype.execute = function(name,params) {
	return this._api('execute.'+name,params);
}

/**
 * Проверяет является ли ошибка ApiError
 *
 * @param mixed error
 *
 * @return boolean
 */
VK.prototype.isApiError = function(error) {
	return error instanceof this.ApiError;
}

/**
 * Проверяет является ли ошибка RequestError
 *
 * @param mixed error
 *
 * @return boolean
 */
VK.prototype.isRequestError = function(error) {
	return error instanceof this.RequestError;
}

/**
 * Проверяет является ли ошибка AuthError
 *
 * @param mixed error
 *
 * @return boolean
 */
VK.prototype.isAuthError = function(error) {
	return error instanceof this.AuthError;
}

/**
 * Проверяет является ли ошибка UnknownError
 *
 * @param mixed error
 *
 * @return boolean
 */
VK.prototype.isUnknownError = function(error) {
	return error instanceof this.UnknownError;
}

/**
 * Проверяет является ли ошибка API
 *
 * @param mixed error
 *
 * @return boolean
 */
VK.prototype.isError = function(error) {
	return this.isApiError(error) || this.isRequestError(error) || this.isAuthError(error) || this.isUnknownError(error);
}

/**
 * Проверяет является ли метод
 *
 * @param string method
 *
 * @return boolean
 */
VK.prototype.isMethod = function(method) {
	return this._apiMethods.indexOf(method) > -1;
}

/**
 * Возвращает кол-во заданий в очереди
 *
 * @return integer
 */
VK.prototype.getQueue = function() {
	return this._queue.length;
}

/**
 * Возвращает токен
 *
 * @return mixed
 */
VK.prototype.getToken = function() {
	return this.settings.token;
}

base.import(VK);

base
.root(__dirname)
.emitter()
.change()
.scan([
	'primary',
	'middleware'
]);

module.exports = base.export();
