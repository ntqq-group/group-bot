import {MessageElem, Sendable} from "@/elements";
import {QQBot} from "@/qqBot";
import {Dict} from "@/types";
import {remove, trimQuote} from "@/utils";
import {Middleware} from "@/middleware";
import {Prompt} from "@/prompt";
import {Bot} from "./bot";
import {User} from "@/entries/user";

export class Message {
    message_type: Message.SubType

    get self_id() {
        return this.bot.self_id
    }

    guild_id?: string
    channel_id?: string
    group_id?: string
    message_id: string
    sender: Message.Sender
    user_id: string
    private _prompt: Prompt

    constructor(public bot: Bot, attrs: Partial<Message>) {
        Object.assign(this, attrs)
        this._prompt = new Prompt(this.bot, this as any, this.bot.config?.delay?.prompt || 5000)
    }

    raw_message: string
    message_reference?: { message_id: string }
    message: Sendable

    get prompt() {
        return this._prompt.prompts
    }

    get promptText() {
        return this._prompt.text
    }

    get promptNumber() {
        return this._prompt.number
    }

    get promptConfirm() {
        return this._prompt.confirm
    }

    get [Symbol.unscopables]() {
        return {
            bot: true
        }
    }

    /**
     * 注册一个中间件
     * @param middleware
     */
    middleware(middleware: Middleware) {
        const fullId = QQBot.getFullTargetId(this as any);
        const newMiddleware = async (event, next) => {
            if (fullId && QQBot.getFullTargetId(event) !== fullId) return next();
            return middleware(event, next);
        }
        (this.bot as Bot).middleware(newMiddleware, true);
        return () => {
            remove((this.bot as Bot).middlewares, newMiddleware)
        }
    }


    toJSON() {
        return Object.fromEntries(Object.keys(this)
            .filter(key => {
                return typeof this[key] !== "function" && !(this[key] instanceof QQBot)
            })
            .map(key => [key, this[key]])
        )
    }
}


export interface MessageEvent {
    reply(message: Sendable, quote?: boolean): Promise<any>
}

export class PrivateMessageEvent extends Message implements MessageEvent {
    constructor(bot: Bot, payload: Partial<Message>) {
        super(bot, payload);
        this.message_type = 'private'
    }

    async reply(message: Sendable) {
        return this.bot.sendPrivateMessage(this.user_id, message, this)
    }
}

export class GroupMessageEvent extends Message implements MessageEvent {
    group_id: string
    group_name: string

    constructor(bot: Bot, payload: Partial<Message>) {
        super(bot, payload);
        this.group_id=payload.group_id
        this.message_type = 'group'
    }

    async reply(message: Sendable) {
        return this.bot.sendGroupMessage(this.group_id, message, this)
    }
}

export class DirectMessageEvent extends Message implements MessageEvent {
    user_id: string
    channel_id: string

    constructor(bot: Bot, payload: Partial<Message>) {
        super(bot, payload);
        this.message_type = 'direct'
    }

    reply(message: Sendable) {
        return this.bot.sendDirectMessage(this.guild_id, message, this)
    }
}

export class GuildMessageEvent extends Message implements MessageEvent {
    guild_id: string
    guild_name: string
    channel_id: string

    get guild() {
        try {
            return this.bot.pickGuild(this.guild_id)
        } catch {
            return null
        }
    }

    get channel() {
        try {
            return this.bot.pickChannel(this.channel_id)
        } catch {
            return null
        }
    }

    channel_name: string

    constructor(bot: Bot, payload: Partial<Message>) {
        super(bot, payload);
        this.message_type = 'guild'
    }

    async asAnnounce() {
        return this.channel.setAnnounce(this.message_id)
    }

    async pin() {
        return this.channel.pinMessage(this.message_id)
    }

    async reply(message: Sendable) {
        return this.bot.sendGuildMessage(this.channel_id, message, this)
    }
}

export namespace Message {
    export interface Sender {
        user_id: string
        user_name: string
        permissions: User.Permission[]
    }

    export type SubType = 'private' | 'group' | 'guild' | 'direct'

    export function parse(this: QQBot, payload: Dict) {
        let template = payload.content || ''
        let result: MessageElem[] = []
        let brief: string = ''
        // 1. 处理文字表情混排
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|‘[^’]*?’|<[^>]+?>)/;
        while (template.length) {
            const [match] = template.match(regex) || [];
            if (!match) break;
            const index = template.indexOf(match);
            const prevText = template.slice(0, index);
            if (prevText) {
                result.push({
                    type: 'text',
                    text: prevText
                })
                brief += prevText
            }
            template = template.slice(index + match.length);
            if (match.startsWith('<')) {
                let [type, ...attrs] = match.slice(1, -1).split(',');
                if (type.startsWith('faceType')) {
                    type = 'face'
                    attrs = attrs.map((attr: string) => attr.replace('faceId', 'id'))
                } else if (type.startsWith('@')) {
                    if (type.startsWith('@!')) {
                        const id = type.slice(2,)
                        type = 'at'
                        attrs = Object.entries(payload.mentions.find((u: Dict) => u.id === id) || {})
                            .map(([key, value]) => `${key}=${value}`)
                    } else if (type === '@everyone') {
                        type = 'at'
                        attrs = [['all', true]]
                    }
                } else if (/^[a-z]+:[0-9]+$/.test(type)) {
                    attrs = ['id=' + type.split(':')[1]]
                    type = 'face'
                }
                result.push({
                    type,
                    ...Object.fromEntries(attrs.map((attr: string) => {
                        const [key, ...values] = attr.split('=')
                        return [key.toLowerCase(), trimQuote(values.join('='))]
                    }))
                })
                brief += `<${type},${attrs.join(',')}>`
            }else{
                result.push({
                    type: "text",
                    text: match
                });
                brief += match;
            }
        }
        if (template) {
            result.push({
                type: 'text',
                text: template
            })
            brief += template
        }
        // 2. 将附件添加到消息中
        if (payload.attachments) {
            for (const attachment of payload.attachments) {
                let {content_type, ...data} = attachment
                const [type] = content_type.split('/')
                result.push({
                    type,
                    ...data,
                    src:`https://${data.src}`,
                    url: `https://${data.url}`
                })
                brief += `<${type},${Object.entries(data).map(([key, value]) => `${key}=${value}`).join(',')}>`
            }
        }
        delete payload.attachments
        delete payload.mentions
        return [result, brief]
    }
}

