define("mmState", ["mmRouter"], function() {
//重写mmRouter中的route方法     
    avalon.router.route = function(method, path, query) {
        path = path.trim()
        var states = this.routingTable[method]
        for (var i = 0, el; el = states[i++]; ) {//el为一个个状态对象，状态对象的callback总是返回一个Promise
            var args = path.match(el.regexp)
            if (args && el.abstract !== true) {//不能是抽象状态
                el.query = query || {}
                el.path = path
                el.params = {}
                var keys = el.keys
                args.shift()
                if (keys.length) {
                    this._parseArgs(args, el)
                }
                if (el.stateName) {
                    mmState.transitionTo(mmState.currentState, el, args)
                } else {
                    el.callback.apply(el, args)
                }
                return
            }
        }
        if (this.errorback) {
            this.errorback()
        }
    }
    //跳转到一个已定义状态上，params对参数对象
    avalon.router.go = function(toName, params) {
        var from = mmState.currentState, to
        var states = this.routingTable.get
        for (var i = 0, el; el = states[i++]; ) {
            if (el.stateName === toName) {
                to = el
                break
            }
        }
        if (to) {
            if (!to.params) {
                to.params = to.parentState ? to.parentState.params || {} : {}
            }
            avalon.mix(true, to.params, params || {})
            var args = to.keys.map(function(el) {
                return to.params [el.name] || ""
            })
            mmState.transitionTo(from, to, args)
        }
    }

    var mmState = {
        currentState: null,
        transitionTo: function(fromState, toState, args) {
            mmState.currentState = toState
            var states = []
            var t = toState
            if (!fromState) {
                while (t) {
                    states.push(t)
                    t = t.parentState
                }
            } else if (fromState === toState) {
                states.push(t)
            } else {
                while (t && t !== fromState) {
                    states.push(t)
                    t = t.parentState
                }
            }
            states.reverse();
            var out = new Promise(function(resolve) {
                resolve()
            })
            states.forEach(function(state) {
                out = out.then(function() {
                    return  state.callback.apply(state, args)
                })
            })
        }
    }
    //【avalon.state】的辅助函数，用于收集可用于扫描的vmodels
    function getVModels(opts) {
        var array = []
        function getVModel(opts, array) {
            var ctrl = opts.controller
            if (avalon.vmodels[ctrl]) {
                avalon.Array.ensure(array, avalon.vmodels[ctrl])
            }
            if (opts.parentState) {
                getVModel(opts.parentState, array)
            }
        }
        getVModel(opts, array)
        return array
    }
    //将template,templateUrl,templateProvider,onBeforeLoad,onAfterLoad这五个属性从opts对象拷贝到新生成的view对象上的
    function copyTemplateProperty(newObj, oldObj, name) {
        newObj[name] = oldObj[name]
        delete  oldObj[name]
    }
    /*
     * 对 avalon.router.get 进行重新封装，生成一个状态对象
     * stateName： 指定当前状态名
     * url:  当前状态对应的路径规则，与祖先状态们组成一个完整的匹配规则
     * controller： 指定当前所在的VM的名字（如果是顶级状态对象，必须指定）
     * views: 对多个[ms-view]容器进行处理,
     *     每个对象应拥有template, templateUrl, templateProvider, onBeforeLoad, onAfterLoad属性
     *     template,templateUrl,templateProvider属性必须指定其一,要求返回一个字符串或一个Promise对象
     *     onBeforeLoad, onAfterLoad是可选
     *     如果不写views属性,则默认view为"",这四个属性可以直接写在opts对象上
     *     views的结构为
     *     {
     *        "": {template: "xxx", onBeforeLoad: function(){} }
     *        "aaa": {template: "xxx", onBeforeLoad: function(){} }
     *        "bbb@": {template: "xxx", onBeforeLoad: function(){} }
     *     }
     *     views的每个键名(keyname)的结构为viewname@statename，
     *         如果名字不存在@，则viewname直接为keyname，statename为opts.stateName
     *         如果名字存在@, viewname为match[0], statename为match[1]
     *     
     * template: 指定当前模板，也可以为一个函数，传入opts.params作参数
     * templateUrl: 指定当前模板的路径，也可以为一个函数，传入opts.params作参数
     * templateProvider: 指定当前模板的提供者，它可以是一个Promise，也可以为一个函数，传入opts.params作参数
     * onChange: 当切换为当前状态时调用的回调，this指向状态对象，参数为匹配的参数，
     *           我们可以在此方法 定义此模板用到的VM， 或修改VM的属性
     * onBeforeLoad: 模板还没有插入DOM树执行的回调，this指向[ms-view]元素节点，参数为状态对象
     * onAfterLoad: 模板还没有插入DOM树执行的回调，this指向[ms-view]元素节点，参数为状态对象
     * abstract:  表示它不参与匹配
     * parentState: 父状态对象（框架内部生成）
     */

    avalon.state = function(stateName, opts) {
        var parent = getParent(stateName)
        if (opts.url === void 0) {
            opts.abstract = true
        }
        if (parent) {
            opts.url = parent.url + (opts.url || "")
            opts.parentState = parent
        }

        opts.stateName = stateName
        if (!opts.views) {
            var view = {}
            "template,templateUrl,templateProvider,onBeforeLoad,onAfterLoad".replace(/\w+/g, function(prop) {
                copyTemplateProperty(view, opts, prop)
            })
            opts.views = {
                "": view
            }
        }
        avalon.router.get(opts.url, function() {
            var that = this, args = arguments
            var promises = []
            getFn(opts, "onChange").apply(that, args)
            var vmodes = getVModels(opts)
            var topCtrlName = vmodes[vmodes.length - 1]
            if (!topCtrlName) {
                avalon.log("topController不存在")
                return
            }

            topCtrlName = topCtrlName.$id
            avalon.each(opts.views, function(keyname, view) {
                if (keyname.indexOf("@") >= 0) {
                    var match = keyname.split("@")
                    var viewname = match[0]
                    var statename = match[1]
                } else {
                    viewname = keyname || ""
                    statename = stateName
                }
                var nodes = getViews(topCtrlName, statename)
                var node = getNamedView(nodes, viewname)
                var warnings = "warning: " + stateName + "状态对象的【" + keyname + "】视图对象"
                if (node) {
                    var promise = fromPromise(view, that.params)
                    getFn(view, "onBeforeLoad").call(node, that)
                    promise.then(function(s) {
                        avalon.innerHTML(node, s)
                        getFn(view, "onAfterLoad").call(node, that)
                        avalon.scan(node, vmodes)
                    }, function(msg) {
                        avalon.log(warnings + " " + msg)

                    })
                    promises.push(promise)
                } else {
                    avalon.log(warnings + "对应的元素节点不存在")
                }
            })

            return Promise.all(promises)

        }, opts)

        return this
    }
    //【avalon.state】的辅助函数，确保返回的是函数
    function getFn(object, name) {
        return typeof object[name] === "function" ? object[name] : avalon.noop
    }
    // 【avalon.state】的辅助函数，收集所有要渲染的[ms-view]元素
    function getViews(ctrl, name) {
        var v = avalon.vmodels[ctrl]
        var firstExpr = v && v.$events.expr || "[ms-controller='" + ctrl + "']"
        var otherExpr = []
        name.split(".").forEach(function() {
            otherExpr.push("[ms-view]")
        })
        if (document.querySelectorAll) {
            return document.querySelectorAll(firstExpr + " " + otherExpr.join(" "))
        } else {
            var seeds = Array.prototype.filter.call(document.getElementsByTagName("*"), function(node) {
                return typeof node.getAttribute("ms-view") === "string"
            })
            while (otherExpr.length > 1) {
                otherExpr.pop()
                seeds = matchSelectors(seeds, function(node) {
                    return typeof node.getAttribute("ms-view") === "string"
                })
            }
            seeds = matchSelectors(seeds, function(node) {
                return typeof node.getAttribute("ms-controller") === ctrl
            })
            return seeds.map(function(el) {
                return el.node
            })
        }
    }
    // 【avalon.state】的辅助函数，从已有集合中寻找匹配[ms-view="viewname"]表达式的元素节点
    function getNamedView(nodes, viewname) {
        for (var i = 0, el; el = nodes[i++]; ) {
            if (el.getAttribute("ms-view") === viewname) {
                return el
            }
        }
    }
    // 【getViews】的辅助函数，从array数组中得到匹配match回调的子集，此为一个节点集合
    function  matchSelectors(array, match) {
        for (var i = 0, n = array.length; i < n; i++) {
            matchSelector(i, array, match)
        }
        return array.filter(function(el) {
            return el
        })
    }
    // 【matchSelectors】的辅助函数，判定array[i]及其祖先是否匹配match回调
    function matchSelector(i, array, match) {
        var parent = array[i]
        var node = parent
        if (parent.node) {
            parent = parent.parent
            node = parent.node
        }
        while (parent) {
            if (match(parent)) {
                return array[i] = {
                    node: node,
                    parent: parent
                }
            }
            parent = parent.parentNode
        }
        array[i] = false
    }

    // 【avalon.state】的辅助函数，opts.template的处理函数
    function fromString(template, params) {
        var promise = new Promise(function(resolve, reject) {
            var str = typeof template === "function" ? template(params) : template
            if (typeof str == "string") {
                resolve(str)
            } else {
                reject("template必须对应一个字符串或一个返回字符串的函数")
            }
        })
        return promise
    }
    // 【fromUrl】的辅助函数，得到一个XMLHttpRequest对象
    var getXHR = function() {
        return new (window.XMLHttpRequest || ActiveXObject)("Microsoft.XMLHTTP")
    }
    // 【avalon.state】的辅助函数，opts.templateUrl的处理函数
    function fromUrl(url, params) {
        var promise = new Promise(function(resolve, reject) {
            if (typeof url === "function") {
                url = url(params)
            }
            if (typeof url !== "string") {
                return reject("templateUrl必须对应一个URL")
            }
            if (avalon.templateCache[url]) {
                return  resolve(avalon.templateCache[url])
            }
            var xhr = getXHR()
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    var status = xhr.status;
                    if (status > 399 && status < 600) {
                        reject("templateUrl对应资源不存在或没有开启 CORS")
                    } else {
                        resolve(avalon.templateCache[url] = xhr.responseText)
                    }
                }
            }
            xhr.open("GET", url, true)
            if ("withCredentials" in xhr) {
                xhr.withCredentials = true
            }
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
            xhr.send()
        })
        return promise
    }
    // 【avalon.state】的辅助函数，opts.templateProvider的处理函数
    function fromProvider(fn, params) {
        var promise = new Promise(function(resolve, reject) {
            if (typeof fn === "function") {
                var ret = fn(params)
                if (ret && ret.then) {
                    resolve(ret)
                } else {
                    reject("templateProvider为函数时应该返回一个Promise或thenable对象")
                }
            } else if (fn && fn.then) {
                resolve(fn)
            } else {
                reject("templateProvider不为函数时应该对应一个Promise或thenable对象")
            }
        })
        return promise
    }
    // 【avalon.state】的辅助函数，将template或templateUrl或templateProvider转换为可用的Promise对象
    function fromPromise(config, params) {
        return config.template ? fromString(config.template, params) :
                config.templateUrl ? fromUrl(config.templateUrl, params) :
                config.templateProvider ? fromProvider(config.templateProvider, params) :
                new Promise(function(resolve, reject) {
                    reject("必须存在template, templateUrl, templateProvider中的一个")
                })
    }
    //【avalon.state】的辅助函数，得到目标状态对象对应的父状态对象
    function getParent(stateName) {
        var match = stateName.match(/([\.\w]+)\./) || ["", ""]
        var parentName = match[1]
        if (parentName) {
            var states = avalon.router.routingTable.get
            for (var i = 0, state; state = states[i++]; ) {
                if (state.stateName === parentName) {
                    return state
                }
            }
            throw new Error("必须先定义[" + parentName + "]")
        }
    }
})
